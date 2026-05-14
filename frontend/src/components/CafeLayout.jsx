import { Outlet, useParams } from 'react-router-dom';
import CustomerBottomNav from './CustomerBottomNav';

export default function CafeLayout() {
  const { slug } = useParams();

  return (
    <div className="flex flex-col min-h-screen">
      {/* padding keeps content above the fixed bottom nav (60px) + iPhone home indicator */}
      <div style={{ flex: 1, paddingBottom: 'calc(60px + env(safe-area-inset-bottom))' }}>
        <Outlet />
      </div>
      <CustomerBottomNav />
    </div>
  );
}
