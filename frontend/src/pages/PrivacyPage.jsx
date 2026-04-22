import { Link } from 'react-router-dom';
import LegalLayout from '../components/LegalLayout';

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated="April 2025">

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">1. Introduction</h2>
        <p>
          DineVerse ("we", "us", "our") is committed to protecting the privacy of café owners, staff,
          and customers who use our platform. This Privacy Policy explains what data we collect, how
          we use it, with whom we share it, and your rights regarding that data. By using DineVerse,
          you agree to the practices described in this Policy.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">2. Information We Collect</h2>
        <h3 className="font-semibold text-gray-800 mt-3 mb-1">From Café Owners & Staff</h3>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Name, email address, phone number</li>
          <li>Business details: café name, GSTIN, FSSAI number, address</li>
          <li>Payment information (processed by Razorpay — we do not store card or bank details)</li>
          <li>Menu items, pricing, and operational data you enter into the platform</li>
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
          <li>Geolocation (only when you use the map or location features, with your explicit permission)</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">3. How We Use Your Information</h2>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>To provide, operate, and improve the DineVerse platform and Services</li>
          <li>To process subscription payments and send invoices</li>
          <li>To send account-related emails (OTP verification, password reset, billing notifications)</li>
          <li>To generate analytics and reports for café owners</li>
          <li>To respond to support queries submitted via the Help Center</li>
          <li>To detect and prevent fraud, abuse, and security incidents</li>
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
          <li><strong>Razorpay:</strong> For payment processing. Razorpay is PCI-DSS compliant and has its own <a href="https://razorpay.com/privacy/" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">Privacy Policy</a>.</li>
          <li><strong>Cloud infrastructure providers:</strong> For hosting and storage (AWS, Neon, Render). Data is processed in accordance with their privacy policies.</li>
          <li><strong>Legal obligation:</strong> If required by a court order or competent government authority under applicable law.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">5. Data Retention</h2>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Active account data is retained for the duration of your subscription plus 30 days after cancellation.</li>
          <li>Order data is retained for 7 years to meet statutory compliance requirements.</li>
          <li>After 30 days post-cancellation, personal data is permanently deleted. Anonymised aggregate analytics data may be retained longer.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">6. Cookies & Local Storage</h2>
        <p>
          DineVerse uses browser local storage and session storage to maintain login sessions, cart contents,
          and UI preferences (e.g., dismissed hints). We use minimal cookies strictly necessary for platform
          functionality. We do not use tracking or advertising cookies. You may clear browser storage at any
          time through your browser settings, though this may affect platform functionality.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">7. Security</h2>
        <p>
          We use industry-standard security measures including TLS encryption in transit, bcrypt-hashed
          passwords, JWT-based session management with token versioning, HTTP security headers, and
          role-based access controls. However, no system is completely secure. You are responsible for
          maintaining the confidentiality of your account credentials and for notifying us promptly
          of any suspected security breach.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">8. Your Rights</h2>
        <p>You have the right to:</p>
        <ul className="list-disc pl-5 mt-2 space-y-1.5">
          <li>Access the personal data we hold about you</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your data (subject to legal retention requirements)</li>
          <li>Export your data (order history, customer list, etc.) via the built-in CSV export feature</li>
          <li>Withdraw consent where processing is based on your consent</li>
          <li>Lodge a complaint with a relevant supervisory authority</li>
        </ul>
        <p className="mt-3">
          To exercise any of these rights, email us at{' '}
          <a href="mailto:privacy@dine-verse.com" className="text-brand-600 hover:underline">privacy@dine-verse.com</a>.
          We will respond within 30 days.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">9. Third-Party Links</h2>
        <p>
          The Platform may contain links to third-party websites or services. We are not responsible
          for the privacy practices of those third parties. We encourage you to review their privacy
          policies before providing any personal information.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">10. Children's Privacy</h2>
        <p>
          The DineVerse platform is not directed at children under 13. We do not knowingly collect
          personal data from children under 13. If you believe a child has provided us personal data,
          contact us immediately and we will delete it promptly.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">11. Changes to this Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of material changes
          via email or an in-app notice at least 7 days before the changes take effect. Continued use
          of the Platform after the effective date constitutes acceptance of the revised Policy.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">12. Contact & Grievance Officer</h2>
        <p>
          For privacy-related questions, to exercise your rights, or to raise a grievance, contact our
          designated Grievance Officer:
        </p>
        <div className="mt-3 bg-gray-50 rounded-xl p-4 space-y-1 text-sm">
          <p><strong>Grievance Officer:</strong> Kalpak Bhoir</p>
          <p><strong>Email:</strong> <a href="mailto:privacy@dine-verse.com" className="text-brand-600 hover:underline">privacy@dine-verse.com</a></p>
          <p><strong>Response time:</strong> Within 15 working days of receipt of complaint</p>
        </div>
        <p className="mt-3">
          You may also visit our <Link to="/contact" className="text-brand-600 hover:underline">Contact Us</Link> page.
        </p>
      </section>

    </LegalLayout>
  );
}
