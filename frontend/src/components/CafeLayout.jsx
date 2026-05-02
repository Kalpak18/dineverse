import { Outlet, useParams } from 'react-router-dom';
import CustomerBottomNav from './CustomerBottomNav';

export default function CafeLayout() {
  const { slug } = useParams();

  return (
    <div className="flex flex-col min-h-screen">
      {/* pb-[60px] keeps content above the fixed bottom nav on all pages */}
      <div className="pb-[60px]" style={{ flex: 1 }}>
        <Outlet />
      </div>
      <CustomerBottomNav />
    </div>
  );
}
