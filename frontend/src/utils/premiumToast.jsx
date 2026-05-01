import toast from 'react-hot-toast';

const UPGRADE_URL = '/owner/billing';

// Friendly amber prompt — not an error, an invitation to upgrade
export function premiumToast(featureName = 'This feature') {
  toast(
    (t) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>⭐</span>
        <span>
          <strong>{featureName}</strong> is a Kitchen Pro feature.{' '}
          <a
            href={UPGRADE_URL}
            onClick={() => toast.dismiss(t.id)}
            style={{ color: '#d97706', textDecoration: 'underline', fontWeight: 600 }}
          >
            Upgrade plan
          </a>
        </span>
      </span>
    ),
    {
      duration: 6000,
      style: {
        background: '#fffbeb',
        color: '#78350f',
        border: '1px solid #fde68a',
        borderRadius: 10,
        padding: '10px 14px',
      },
    }
  );
}

export function isPremiumError(err) {
  return err?.response?.data?.error === 'premium_required';
}
