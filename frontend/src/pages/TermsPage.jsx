import { Link } from 'react-router-dom';
import DineLogo from '../components/DineLogo';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link to="/"><DineLogo size="sm" /></Link>
          <div className="flex gap-4 text-sm text-gray-500">
            <Link to="/privacy" className="hover:text-gray-900">Privacy Policy</Link>
            <Link to="/owner/register" className="text-brand-600 font-medium hover:underline">Register</Link>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Terms & Conditions</h1>
        <p className="text-sm text-gray-400 mb-10">Last updated: April 2025</p>

        <div className="prose prose-gray max-w-none space-y-8 text-gray-700 text-sm leading-relaxed">

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">1. Acceptance of Terms</h2>
            <p>
              By registering for or using DineVerse ("the Platform", "we", "us"), you ("the Owner", "User") agree to
              be bound by these Terms & Conditions. If you do not agree, do not use the Platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">2. Description of Service</h2>
            <p>
              DineVerse provides a cloud-based restaurant and café management platform including digital menus,
              QR-based ordering, kitchen display, GST billing, analytics, staff management, and related features
              (collectively, "Services"). The Platform is provided on a subscription basis after a free trial period.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">3. Account Registration</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>You must provide accurate, complete, and current information during registration.</li>
              <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
              <li>You must be at least 18 years old and legally authorised to operate a food business in India.</li>
              <li>One account may be used for multiple outlets under the same subscription.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">4. Subscription & Payments</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>A 30-day free trial is offered with full feature access. No credit card is required for the trial.</li>
              <li>After the trial, continued use requires a paid subscription (annual or multi-year plans).</li>
              <li>Payments are processed via Razorpay. DineVerse does not store your card details.</li>
              <li>Subscriptions are non-refundable except as required by applicable Indian law.</li>
              <li>Prices are subject to change with 30 days notice.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">5. Owner Responsibilities</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>You are solely responsible for the accuracy of your menu, pricing, and business information.</li>
              <li>You are responsible for maintaining valid FSSAI, GSTIN, and other regulatory licenses required for your business.</li>
              <li>DineVerse is a software tool — it does not participate in any transaction between you and your customers. You are the merchant of record for all orders placed through your café link.</li>
              <li>You must not use the Platform for any illegal, fraudulent, or harmful purpose.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">6. Customer Orders</h2>
            <p>
              Orders placed by customers via DineVerse are between the customer and the restaurant/café owner.
              DineVerse facilitates the order flow but is not liable for order fulfillment, food quality, delivery,
              or disputes arising between customers and owners.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">7. Data & Privacy</h2>
            <p>
              We collect and process your data as described in our{' '}
              <Link to="/privacy" className="text-brand-600 hover:underline">Privacy Policy</Link>.
              By using the Platform you consent to such processing. Customer data collected through your
              café page (names, phone numbers, order history) is accessible to you as the business owner
              and must be handled in accordance with applicable data protection laws.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">8. Intellectual Property</h2>
            <p>
              The DineVerse platform, including its software, design, trademarks, and content, is owned by
              DineVerse and protected by Indian and international intellectual property laws. You may not
              copy, modify, distribute, or reverse-engineer any part of the Platform.
            </p>
            <p className="mt-2">
              You retain ownership of your business data (menu, orders, customer records) and may export
              it at any time using the CSV export feature.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">9. Service Availability</h2>
            <p>
              We aim for 99.5% uptime but do not guarantee uninterrupted access. Scheduled maintenance
              and force-majeure events are excluded from SLA calculations. We will endeavour to notify
              you of planned downtime in advance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">10. Termination</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>You may cancel your account at any time by contacting support.</li>
              <li>We may suspend or terminate accounts that violate these Terms, engage in fraudulent activity, or fail to pay subscription fees.</li>
              <li>Upon termination, your data is retained for 30 days to allow export, after which it is permanently deleted.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">11. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by applicable law, DineVerse shall not be liable for any
              indirect, incidental, special, or consequential damages arising from your use of the Platform,
              including loss of revenue, data loss, or business interruption. Our total liability is limited
              to the subscription fees paid in the 3 months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">12. Governing Law</h2>
            <p>
              These Terms are governed by the laws of India. Any disputes shall be subject to the exclusive
              jurisdiction of the courts in Mumbai, Maharashtra, India.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">13. Changes to Terms</h2>
            <p>
              We may update these Terms from time to time. Continued use of the Platform after changes
              constitutes acceptance of the revised Terms. We will notify you of material changes by email
              or in-app notice.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-2">14. Contact</h2>
            <p>
              For questions about these Terms, contact us at{' '}
              <a href="mailto:legal@dine-verse.com" className="text-brand-600 hover:underline">legal@dine-verse.com</a>.
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-gray-100 flex flex-col sm:flex-row gap-3 items-center justify-between text-sm text-gray-400">
          <span>© 2025 DineVerse. All rights reserved.</span>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:text-gray-700">Privacy Policy</Link>
            <Link to="/" className="hover:text-gray-700">Home</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
