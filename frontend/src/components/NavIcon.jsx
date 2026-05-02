/** Crisp 24-px stroke SVG icons — used in sidebar nav and throughout the app. */
export default function NavIcon({ name, className = 'w-[18px] h-[18px] flex-shrink-0' }) {
  const p = {
    className,
    fill: 'none',
    stroke: 'currentColor',
    viewBox: '0 0 24 24',
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  };

  switch (name) {
    case 'dashboard':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );

    case 'orders':
      return (
        <svg {...p}>
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <line x1="9" y1="12" x2="15" y2="12" />
          <line x1="9" y1="16" x2="13" y2="16" />
        </svg>
      );

    case 'messages':
      return (
        <svg {...p}>
          <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72A7.969 7.969 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      );

    case 'kitchen':
      return (
        <svg {...p}>
          <path d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.974 7.974 0 01-2.343 5.657z" />
          <path d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
        </svg>
      );

    case 'menu':
      return (
        <svg {...p}>
          <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      );

    case 'offers':
      return (
        <svg {...p}>
          <path d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
      );

    case 'reservations':
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );

    case 'ratings':
      return (
        <svg {...p}>
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );

    case 'analytics':
      return (
        <svg {...p}>
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
          <line x1="2" y1="20" x2="22" y2="20" />
        </svg>
      );

    case 'staff':
      return (
        <svg {...p}>
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87" />
          <path d="M16 3.13a4 4 0 010 7.75" />
        </svg>
      );

    case 'tables':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="9" x2="9" y2="21" />
          <line x1="15" y1="9" x2="15" y2="21" />
        </svg>
      );

    case 'inventory':
      return (
        <svg {...p}>
          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      );

    case 'customers':
      return (
        <svg {...p}>
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );

    case 'waitlist':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 15" />
        </svg>
      );

    case 'schedule':
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <line x1="8" y1="14" x2="8" y2="14" strokeWidth="2.5" />
          <line x1="12" y1="14" x2="12" y2="14" strokeWidth="2.5" />
          <line x1="16" y1="14" x2="16" y2="14" strokeWidth="2.5" />
          <line x1="8" y1="18" x2="8" y2="18" strokeWidth="2.5" />
          <line x1="12" y1="18" x2="12" y2="18" strokeWidth="2.5" />
        </svg>
      );

    case 'billing':
      return (
        <svg {...p}>
          <rect x="1" y="4" width="22" height="16" rx="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
      );

    case 'help':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" strokeWidth="2.5" />
        </svg>
      );

    case 'profile':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      );

    case 'logout':
      return (
        <svg {...p}>
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      );

    case 'qrcode':
      return (
        <svg {...p}>
          {/* top-left finder */}
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="5" y="5" width="3" height="3" fill="currentColor" stroke="none" />
          {/* top-right finder */}
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="16" y="5" width="3" height="3" fill="currentColor" stroke="none" />
          {/* bottom-left finder */}
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="5" y="16" width="3" height="3" fill="currentColor" stroke="none" />
          {/* data dots */}
          <rect x="14" y="14" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
          <rect x="18" y="14" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
          <rect x="14" y="18" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
          <rect x="18" y="18" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
          <rect x="16" y="16" width="2" height="2" rx="0.5" fill="currentColor" stroke="none" />
        </svg>
      );

    case 'map':
      return (
        <svg {...p}>
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
      );

    case 'cashier':
      return (
        <svg {...p}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      );

    case 'chef':
      return (
        <svg {...p}>
          <path d="M6 13.87A4 4 0 017.41 6a5.11 5.11 0 0119 4.76 2.5 2.5 0 01-2.17 2.79l-.22.02H6.41" />
          <line x1="6" y1="17" x2="18" y2="17" />
          <line x1="6" y1="21" x2="18" y2="21" />
        </svg>
      );

    case 'manager':
      return (
        <svg {...p}>
          <circle cx="12" cy="8" r="4" />
          <path d="M6 20v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
          <polyline points="16 11 18 13 22 9" />
        </svg>
      );

    case 'shift':
      return (
        <svg {...p}>
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 3l-4 4-4-4" />
          <line x1="12" y1="12" x2="12" y2="16" />
          <line x1="10" y1="14" x2="14" y2="14" />
        </svg>
      );

    case 'loyalty':
      return (
        <svg {...p}>
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      );

    case 'modifiers':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
        </svg>
      );

    case 'waiter':
      return (
        <svg {...p}>
          <path d="M12 2a2 2 0 110 4 2 2 0 010-4z" />
          <path d="M4 10h16M4 10a8 8 0 0016 0M12 14v6M9 20h6" />
        </svg>
      );

    default:
      return null;
  }
}
