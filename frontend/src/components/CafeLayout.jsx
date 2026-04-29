import { Outlet, useLocation, useParams } from 'react-router-dom';
import CustomerBottomNav from './CustomerBottomNav';

// Hides nav on confirmation page so it doesn't compete with the order-placed screen
const NO_NAV_PATHS = ['/confirmation'];

export default function CafeLayout() {
  const { slug } = useParams();
  const { pathname } = useLocation();
  const showNav = !NO_NAV_PATHS.some((p) => pathname.endsWith(p));

  return (
    <div className="flex flex-col min-h-screen">
      {/* All page content sits in this container. pb-[60px] prevents any fixed/absolute
          bottom elements inside child pages from being hidden behind the nav bar. */}
      <div className={showNav ? 'pb-[60px]' : ''} style={{ flex: 1 }}>
        <Outlet />
      </div>
      {showNav && <CustomerBottomNav />}
    </div>
  );
}
