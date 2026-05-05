import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { updateProfile } from '../../services/api';
import { getWeekSchedule, defaultSchedule, formatTime } from '../../utils/scheduleUtils';
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
];

// Build 30-min interval time options for selects
const TIME_OPTIONS = (() => {
  const opts = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      const val = `${hh}:${mm}`;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hour = h % 12 || 12;
      opts.push({ value: val, label: `${hour}:${mm} ${ampm}` });
    }
  }
  return opts;
})();

export default function SchedulePage() {
  const { cafe, updateCafe } = useAuth();

  const [schedule, setSchedule] = useState(null);
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [saving, setSaving] = useState(false);

  // Initialise from café data
  useEffect(() => {
    const hours = cafe?.opening_hours || defaultSchedule();
    setSchedule(hours);
    setTimezone(cafe?.timezone || 'Asia/Kolkata');
  }, [cafe]);

  const days = schedule ? getWeekSchedule(schedule) : [];

  const setDay = (key, patch) =>
    setSchedule((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const applyAllWeekdays = (patch) => {
    setSchedule((prev) => {
      const next = { ...prev };
      ['mon', 'tue', 'wed', 'thu', 'fri'].forEach((k) => {
        next[k] = { ...next[k], ...patch };
      });
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data } = await updateProfile({
        // pass through required fields so validation passes
        name: cafe?.name,
        phone: cafe?.phone,
        opening_hours: schedule,
        timezone,
      });
      if (data?.cafe) updateCafe(data.cafe);
      toast.success('Schedule saved');
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const clearSchedule = async () => {
    if (!window.confirm('Remove schedule? Café open/closed will be controlled by the manual toggle only.')) return;
    setSaving(true);
    try {
      const { data } = await updateProfile({
        name: cafe?.name,
        phone: cafe?.phone,
        opening_hours: null,
        timezone,
      });
      if (data?.cafe) updateCafe(data.cafe);
      setSchedule(defaultSchedule());
      toast.success('Schedule cleared — using manual toggle');
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (!schedule) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Operating Hours</h1>
        <p className="text-sm text-gray-500 mt-1">
          Set your weekly schedule. Orders placed outside these hours will be automatically blocked.
          The manual open/close toggle still works as an override.
        </p>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
        <strong>How it works:</strong> When a customer tries to order outside your open hours, they
        see "Café not open yet — opens at X" and cannot submit. You can still manually close early
        anytime via the Dashboard toggle.
      </div>

      {/* Timezone */}
      <div className="card">
        <label className="label">Timezone</label>
        <select
          className="input"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
        <p className="text-xs text-gray-400 mt-1">
          All open/close times are interpreted in this timezone.
        </p>
      </div>

      {/* Weekly schedule */}
      <div className="card space-y-1 p-0 overflow-hidden">
        {/* Bulk action header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Weekly Schedule</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => applyAllWeekdays({ open: '09:00', close: '22:00', closed: false })}
              className="text-xs text-brand-600 hover:underline font-medium"
            >
              Set Mon–Fri 9–10pm
            </button>
          </div>
        </div>

        {days.map((day, idx) => (
          <div
            key={day.key}
            className={`flex items-center gap-3 px-4 py-3 ${idx < days.length - 1 ? 'border-b border-gray-100' : ''} ${day.closed ? 'opacity-60' : ''}`}
          >
            {/* Day name */}
            <span className="w-24 text-sm font-medium text-gray-700 flex-shrink-0">{day.label}</span>

            {/* Closed toggle */}
            <label className="flex items-center gap-1.5 cursor-pointer select-none flex-shrink-0">
              <input
                type="checkbox"
                className="rounded"
                checked={day.closed}
                onChange={(e) => setDay(day.key, { closed: e.target.checked })}
              />
              <span className="text-xs text-gray-500">Closed</span>
            </label>

            {/* Time selects */}
            {!day.closed ? (
              <div className="flex items-center gap-2 flex-1">
                <select
                  className="input py-1.5 text-sm flex-1"
                  value={day.open}
                  onChange={(e) => setDay(day.key, { open: e.target.value })}
                >
                  {TIME_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <span className="text-gray-400 text-sm flex-shrink-0">to</span>
                <select
                  className="input py-1.5 text-sm flex-1"
                  value={day.close}
                  onChange={(e) => setDay(day.key, { close: e.target.value })}
                >
                  {TIME_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <span className="text-xs text-gray-400 ml-2">No orders accepted</span>
            )}

            {/* Today indicator */}
            {day.key === new Date().toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase().slice(0, 3) && (
              <span className="text-xs bg-brand-100 text-brand-700 font-medium px-2 py-0.5 rounded-full flex-shrink-0">Today</span>
            )}
          </div>
        ))}
      </div>

      {/* Preview */}
      <div className="card bg-gray-50">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Preview — what customers see</p>
        <div className="space-y-1">
          {days.map((day) => (
            <div key={day.key} className="flex justify-between text-sm">
              <span className="text-gray-600">{day.label}</span>
              <span className={day.closed ? 'text-red-500' : 'text-gray-800'}>
                {day.closed ? 'Closed' : `${formatTime(day.open)} – ${formatTime(day.close)}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-primary flex-1 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save Schedule'}
        </button>
        <button
          type="button"
          onClick={clearSchedule}
          disabled={saving}
          className="btn-secondary disabled:opacity-60"
        >
          Clear
        </button>
      </div>

    </div>
  );
}
