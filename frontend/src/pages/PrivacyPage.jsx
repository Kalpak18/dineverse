import { Link } from 'react-router-dom';
import DineLogo from '../components/DineLogo';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link to="/"><DineLogo size="sm" /></Link>
          <div className="flex gap-4 text-sm text-gray-500">
            <Link to="/terms" className="hover:text-gray-900">Terms & Conditions</Link>
            <Link to="/owner/register" className="text-brand-600 font-medium hover:underline">Register</Link>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-400 mb-10">Last updated: April 2025</p>

        <div className="prose prose-gray max-w-none space-y-8 text-gray-700 text-sm leading-relaxed">

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">1. Introduction</h2>
            <p>
              DineVerse ("we", "us", "our") is committed to protecting the privacy of café owners, staff,
              and customers who use our platform. This Privacy Policy explains what data we collect, how
              we use it, and your rights regarding that data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">2. Information We Collect</h2>
            <h3 className="font-semibold text-gray-800 mt-3 mb-1">From Café Owners & Staff</h3>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Name, email address, phone number</li>
              <li>Business details: café name, GSTIN, FSSAI number, address</li>
              <li>Payment information (processed by Razorpay — we do not store card details)</li>
              <li>Menu items, pricing, and operational data you enter</li>
              <li>Usage logs: pages visited, actions taken, timestamps</li>
            </ul>
            <h3 className="font-semibold text-gray-800 mt-4 mb-1">From Customers (via café pages)</h3>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Name and phone number (entered when starting an order session)</li>
              <li>Order history: items ordered, amounts, timestamps</li>
              <li>Table number or delivery address</li>
              <li>Reviews and ratings submitted after an order</li>
              <li>Messages sent to the café via in-app chat</li>
            </ul>
            <h3 className="font-semibold text-gray-800 mt-4 mb-1">Automatically Collected</h3>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>IP address, browser type, device type</li>
              <li>Pages visited and session duration</li>
              <li>Geolocation (only when you use the map or location features, with permission)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>To provide and improve the DineVerse platform and Services</li>
              <li>To process subscription payments and send invoices</li>
              <li>To send account-related emails (OTP verification, password reset, billing notifications)</li>
              <li>To generate analytics and reports for café owners</li>
              <li>To respond to support queries submitted via the Help Center</li>
              <li>To detect and prevent fraud and abuse</li>
              <li>To comply with applicable laws and regulations</li>
            </ul>
            <p className="mt-3">
              We do not sell, rent, or share your personal data with third-party advertisers.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">4. Data Sharing</h2>
            <p>We share data only in the following limited circumstances:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1.5">
              <li><strong>With café owners:</strong> Customer order data (name, phone, order history) is accessible to the café owner whose platform they ordered from.</li>
              <li><strong>Razorpay:</strong> For payment processing. Razorpay has its own Privacy Policy.</li>
              <li><strong>Cloud infrastructure providers:</strong> For hosting and storage (data remains in India).</li>
              <li><strong>Legal obligation:</strong> If required by a court order or government authority under Indian law.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">5. Data Retention</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Active account data is retained for the duration of your subscription plus 30 days after cancellation.</li>
              <li>Order data is retained for 7 years to meet GST compliance requirements under Indian law.</li>
              <li>After 30 days post-cancellation, personal data is permanently deleted. Anonymised analytics data may be retained longer.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">6. Cookies & Local Storage</h2>
            <p>
              DineVerse uses browser local storage and session storage to maintain login sessions, cart contents,
              and UI preferences (e.g., dismissed hints). We use minimal cookies strictly necessary for functionality.
              We do not use tracking or advertising cookies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">7. Security</h2>
            <p>
              We use industry-standard security measures including TLS encryption in transit, hashed passwords,
              and access controls. However, no system is completely secure. You are responsible for maintaining
              the confidentiality of your account credentials.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">8. Your Rights</h2>
            <p>Under applicable Indian data protection law, you have the right to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1.5">
              <li>Access the personal data we hold about you</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion of your data (subject to legal retention requirements)</li>
              <li>Export your data (order history, customer list, etc.) via the built-in CSV export</li>
              <li>Withdraw consent where processing is based on consent</li>
            </ul>
            <p className="mt-3">To exercise any of these rights, email us at <a href="mailto:privacy@dine-verse.com" className="text-brand-600 hover:underline">privacy@dine-verse.com</a>.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">9. Children's Privacy</h2>
            <p>
              The DineVerse platform is not directed at children under 13. We do not knowingly collect data
              from children under 13. If you believe a child has provided us personal data, contact us
              and we will delete it.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">10. Changes to this Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of material changes
              via email or an in-app notice. Continued use of the Platform after changes constitutes acceptance
              of the revised Policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">11. Contact</h2>
            <p>
              For privacy-related questions or to exercise your rights, contact:{' '}
              <a href="mailto:privacy@dine-verse.com" className="text-brand-600 hover:underline">privacy@dine-verse.com</a>
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-gray-100 flex flex-col sm:flex-row gap-3 items-center justify-between text-sm text-gray-400">
          <span>© 2025 DineVerse. All rights reserved.</span>
          <div className="flex gap-4">
            <Link to="/terms" className="hover:text-gray-700">Terms & Conditions</Link>
            <Link to="/" className="hover:text-gray-700">Home</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
