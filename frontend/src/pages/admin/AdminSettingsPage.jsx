import { useState, useEffect } from 'react';
import { adminGetSettings, adminUpdateSetting, adminBroadcast } from '../../services/api';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/LoadingSpinner';

// ─── Emoji Map Editor ─────────────────────────────────────────
function EmojiMapEditor({ initial, onSave, saving }) {
  const [pairs, setPairs] = useState(
    Object.entries(initial || {}).map(([keyword, emoji]) => ({ keyword, emoji, id: Math.random() }))
  );
  const [newKeyword, setNewKeyword] = useState('');
  const [newEmoji, setNewEmoji]     = useState('');

  const update = (id, field, val) =>
    setPairs((prev) => prev.map((p) => p.id === id ? { ...p, [field]: val } : p));

  const remove = (id) => setPairs((prev) => prev.filter((p) => p.id !== id));

  const add = () => {
    if (!newKeyword.trim() || !newEmoji.trim()) return;
    setPairs((prev) => [...prev, { keyword: newKeyword.trim().toLowerCase(), emoji: newEmoji.trim(), id: Math.random() }]);
    setNewKeyword(''); setNewEmoji('');
  };

  const handleSave = () => {
    const map = {};
    for (const { keyword, emoji } of pairs) {
      if (keyword.trim() && emoji.trim()) map[keyword.trim().toLowerCase()] = emoji.trim();
    }
    onSave(map);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold">Category Emoji Map</h3>
          <p className="text-gray-400 text-xs mt-0.5">
            When a category name contains a keyword, this emoji shows as its icon on the customer menu.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {/* Existing pairs */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="grid grid-cols-[1fr_80px_40px] gap-0 text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 border-b border-gray-800">
          <span>Keyword</span><span className="text-center">Emoji</span><span />
        </div>
        <div className="max-h-80 overflow-y-auto divide-y divide-gray-800">
          {pairs.map((p) => (
            <div key={p.id} className="grid grid-cols-[1fr_80px_40px] items-center gap-2 px-4 py-2">
              <input
                value={p.keyword}
                onChange={(e) => update(p.id, 'keyword', e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white w-full focus:outline-none focus:border-brand-500"
                placeholder="keyword"
              />
              <input
                value={p.emoji}
                onChange={(e) => update(p.id, 'emoji', e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white text-center w-full focus:outline-none focus:border-brand-500"
                placeholder="🍕"
              />
              <button
                onClick={() => remove(p.id)}
                className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Add new pair */}
      <div className="flex gap-2">
        <input
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="New keyword (e.g. sushi)"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
        />
        <input
          value={newEmoji}
          onChange={(e) => setNewEmoji(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="🍣"
          className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white text-center focus:outline-none focus:border-brand-500"
        />
        <button
          onClick={add}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg"
        >
          + Add
        </button>
      </div>

      <p className="text-xs text-gray-500">
        {pairs.length} keyword{pairs.length !== 1 ? 's' : ''} configured · Changes are live immediately after saving
      </p>
    </div>
  );
}

// ─── Announcement Editor ──────────────────────────────────────
function AnnouncementEditor({ initial, onSave, saving }) {
  const [text, setText]     = useState(initial?.text || '');
  const [active, setActive] = useState(initial?.active || false);
  const [type, setType]     = useState(initial?.type || 'info');

  const handleSave = () => onSave({ text: text.trim(), active, type });

  const typeOptions = [
    { value: 'info',    label: 'ℹ️ Info (blue)',    bg: 'bg-blue-900/30 border-blue-700' },
    { value: 'warning', label: '⚠️ Warning (amber)', bg: 'bg-amber-900/30 border-amber-700' },
    { value: 'success', label: '✅ Success (green)', bg: 'bg-green-900/30 border-green-700' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold">Platform Announcement</h3>
          <p className="text-gray-400 text-xs mt-0.5">
            Shows a banner on the owner dashboard for all cafés when active.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <div
              onClick={() => setActive((v) => !v)}
              className={`w-10 h-6 rounded-full transition-colors relative ${active ? 'bg-brand-600' : 'bg-gray-700'}`}
            >
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${active ? 'translate-x-5' : 'translate-x-1'}`} />
            </div>
            <span className="text-sm text-gray-300">{active ? 'Active' : 'Inactive'}</span>
          </label>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        {typeOptions.map((t) => (
          <button
            key={t.value}
            onClick={() => setType(t.value)}
            className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-colors ${
              type === t.value ? t.bg + ' text-white' : 'border-gray-700 text-gray-400 hover:border-gray-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="e.g. We will be doing maintenance on Sunday 2AM–4AM IST. Expect brief downtime."
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 resize-none"
      />

      {text && (
        <div className={`rounded-xl px-4 py-3 text-sm border ${
          type === 'warning' ? 'bg-amber-900/30 border-amber-700 text-amber-200' :
          type === 'success' ? 'bg-green-900/30 border-green-700 text-green-200' :
                               'bg-blue-900/30 border-blue-700 text-blue-200'
        }`}>
          <strong>Preview:</strong> {text}
        </div>
      )}
    </div>
  );
}

// ─── Broadcast Email ──────────────────────────────────────────
function BroadcastPanel() {
  const [subject, setSubject]       = useState('');
  const [message, setMessage]       = useState('');
  const [planFilter, setPlanFilter] = useState('all');
  const [sending, setSending]       = useState(false);

  const handleSend = async () => {
    if (!subject.trim() || !message.trim()) { toast.error('Subject and message are required'); return; }
    if (!confirm(`Send this email to all ${planFilter === 'all' ? '' : planFilter + ' '}cafés? This cannot be undone.`)) return;
    setSending(true);
    try {
      const { data } = await adminBroadcast({ subject, message, plan_filter: planFilter });
      toast.success(`Sent to ${data.sent} cafés${data.failed > 0 ? `, ${data.failed} failed` : ''}`);
      setSubject(''); setMessage('');
    } catch {
      toast.error('Broadcast failed — check SMTP config');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-white font-semibold">Broadcast Email</h3>
        <p className="text-gray-400 text-xs mt-0.5">Send an email to all café owners on the platform.</p>
      </div>

      <div className="flex gap-2">
        {[
          { value: 'all',   label: '👥 All Cafés' },
          { value: 'paid',  label: '💳 Paid Only' },
          { value: 'trial', label: '🆓 Trial Only' },
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setPlanFilter(f.value)}
            className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-colors ${
              planFilter === f.value
                ? 'bg-brand-600 border-brand-500 text-white'
                : 'border-gray-700 text-gray-400 hover:border-gray-500'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Email subject"
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
      />
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={5}
        placeholder="Email message body..."
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 resize-none"
      />
      <button
        onClick={handleSend}
        disabled={sending || !subject || !message}
        className="w-full py-3 bg-brand-600 hover:bg-brand-500 text-white font-semibold rounded-xl disabled:opacity-50 transition-colors"
      >
        {sending ? 'Sending…' : `📨 Send Broadcast`}
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function AdminSettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(null); // key being saved
  const [activeTab, setActiveTab] = useState('emoji');

  useEffect(() => {
    adminGetSettings()
      .then(({ data }) => setSettings(data.settings))
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (key, value) => {
    setSaving(key);
    try {
      await adminUpdateSetting(key, value);
      setSettings((prev) => ({ ...prev, [key]: { ...prev[key], value } }));
      toast.success('Saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <LoadingSpinner />;

  const tabs = [
    { id: 'emoji',        label: '🍽️ Category Emojis' },
    { id: 'announcement', label: '📢 Announcement' },
    { id: 'broadcast',    label: '📨 Broadcast Email' },
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Platform Settings</h1>
        <p className="text-gray-400 text-sm mt-1">
          Control platform-wide configuration without touching code.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors ${
              activeTab === t.id
                ? 'bg-brand-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        {activeTab === 'emoji' && (
          <EmojiMapEditor
            initial={settings?.category_emoji_map?.value}
            onSave={(val) => handleSave('category_emoji_map', val)}
            saving={saving === 'category_emoji_map'}
          />
        )}
        {activeTab === 'announcement' && (
          <AnnouncementEditor
            initial={settings?.announcement?.value}
            onSave={(val) => handleSave('announcement', val)}
            saving={saving === 'announcement'}
          />
        )}
        {activeTab === 'broadcast' && <BroadcastPanel />}
      </div>

      {/* Last updated info */}
      {settings && (
        <div className="text-xs text-gray-600 space-y-1">
          {Object.entries(settings).map(([key, s]) => (
            <p key={key}>
              <span className="text-gray-500">{s.label || key}</span> last updated{' '}
              {new Date(s.updated_at).toLocaleString('en-IN')}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
