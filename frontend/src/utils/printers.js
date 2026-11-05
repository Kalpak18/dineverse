// Sending ESC/POS bytes to a receipt printer straight from the browser — no
// print screen. Each device remembers its own printer (localStorage).
//
//   bluetooth  Web Bluetooth (BLE printers)            Chrome on Android / desktop
//   serial     Web Serial: Bluetooth "classic" printers on Android Chrome 138+
//              (pair in Android settings first) and USB-serial printers on PCs
//   usb        WebUSB: USB printers (Android tablet + OTG cable, or a PC)
//   rawbt      the RawBT Android app — any printer it supports, incl. LAN/Wi-Fi
//   system     the device's normal print screen (always available)

const KEY = 'dv_printer';

export const PRINTER_METHODS = [
  { id: 'system', label: 'Device print screen', hint: 'Works everywhere — opens the print screen each time' },
  { id: 'bluetooth', label: 'Bluetooth printer (BLE)', hint: 'Most newer Bluetooth receipt printers — Chrome on Android or a laptop', supported: () => !!navigator.bluetooth },
  { id: 'serial', label: 'Bluetooth (classic) / USB-serial', hint: 'Older Bluetooth printers paired in Android settings (Chrome 138+), or USB-serial on a PC', supported: () => !!navigator.serial },
  { id: 'usb', label: 'USB printer', hint: 'USB receipt printer — Android tablet with OTG cable, or a PC', supported: () => !!navigator.usb },
  { id: 'rawbt', label: 'RawBT app (Android)', hint: 'Install "RawBT" from Play Store — Bluetooth, USB or network (LAN/Wi-Fi) printers', supported: () => /Android/i.test(navigator.userAgent) },
];

export function getPrinter() {
  try { return { method: 'system', width: 80, cut: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { method: 'system', width: 80, cut: true }; }
}
export function savePrinter(cfg) {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* private mode */ }
}

// ── Bluetooth (BLE) ───────────────────────────────────────────────
// Services used by common thermal printers (generic 0x18F0, ISSC, Xprinter…)
const BLE_SERVICES = [
  0x18f0, 0xff00, 0xffe0, 0xfee7, 0xae30,
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];
let bleChar = null;
let bleDevice = null;

async function findWritable(server) {
  for (const service of await server.getPrimaryServices()) {
    for (const ch of await service.getCharacteristics()) {
      if (ch.properties.writeWithoutResponse || ch.properties.write) return ch;
    }
  }
  throw new Error('This Bluetooth device has no printer channel');
}

async function bluetoothChar({ choose }) {
  if (bleChar && bleDevice?.gatt?.connected) return bleChar;
  if (!bleDevice) {
    // Chrome remembers devices allowed before (where supported)
    const known = navigator.bluetooth.getDevices ? await navigator.bluetooth.getDevices().catch(() => []) : [];
    bleDevice = known[0] || null;
  }
  if (!bleDevice) {
    if (!choose) throw new Error('Connect the Bluetooth printer first (Printer → Connect)');
    bleDevice = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  }
  const server = await bleDevice.gatt.connect();
  bleChar = await findWritable(server);
  return bleChar;
}

async function sendBluetooth(bytes, opts) {
  const ch = await bluetoothChar(opts);
  // BLE packets are small: send in chunks
  for (let i = 0; i < bytes.length; i += 180) {
    const chunk = bytes.slice(i, i + 180);
    if (ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(chunk);
    else await ch.writeValue(chunk);
  }
}

// ── Web Serial ────────────────────────────────────────────────────
async function sendSerial(bytes, { choose }) {
  let [port] = await navigator.serial.getPorts();
  if (!port) {
    if (!choose) throw new Error('Connect the printer first (Printer → Connect)');
    port = await navigator.serial.requestPort();
  }
  if (!port.writable) await port.open({ baudRate: 9600 });
  const writer = port.writable.getWriter();
  try { await writer.write(bytes); } finally { writer.releaseLock(); }
}

// ── WebUSB ────────────────────────────────────────────────────────
async function sendUsb(bytes, { choose }) {
  let [device] = await navigator.usb.getDevices();
  if (!device) {
    if (!choose) throw new Error('Connect the USB printer first (Printer → Connect)');
    device = await navigator.usb.requestDevice({ filters: [] });
  }
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  const iface = device.configuration.interfaces.find((i) => i.alternate.endpoints.some((e) => e.direction === 'out'));
  if (!iface) throw new Error('This USB device has no printer channel');
  if (!iface.claimed) await device.claimInterface(iface.interfaceNumber);
  const ep = iface.alternate.endpoints.find((e) => e.direction === 'out');
  await device.transferOut(ep.endpointNumber, bytes);
}

// ── RawBT (Android app) ───────────────────────────────────────────
function sendRawbt(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  window.location.href = `intent:base64,${btoa(bin)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

// Sends to this device's printer. choose: allowed to open the browser's
// "pick a device" dialog (only from a tap, e.g. Connect / Test print).
export async function sendToPrinter(bytes, { choose = false } = {}) {
  const { method } = getPrinter();
  if (method === 'bluetooth') return sendBluetooth(bytes, { choose });
  if (method === 'serial') return sendSerial(bytes, { choose });
  if (method === 'usb') return sendUsb(bytes, { choose });
  if (method === 'rawbt') return sendRawbt(bytes);
  throw new Error('No direct printer set up on this device');
}

export function forgetPrinterConnection() {
  try { bleDevice?.gatt?.disconnect(); } catch { /* already gone */ }
  bleDevice = null;
  bleChar = null;
}
