import { Link } from 'react-router-dom';
import LegalLayout from '../components/LegalLayout';

export default function TermsPage() {
  return (
    <LegalLayout title="Terms & Conditions" updated="April 2025">

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">1. Acceptance of Terms</h2>
        <p>
          By registering for or using DineVerse ("the Platform", "we", "us", "our"), you ("the Owner", "User")
          agree to be bound by these Terms & Conditions. If you do not agree, do not use the Platform.
          These Terms constitute a legally binding agreement between you and DineVerse.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">2. Description of Service</h2>
        <p>
          DineVerse provides a cloud-based restaurant and café management platform including digital menus,
          QR-based ordering, kitchen display, billing, analytics, staff management, and related features
          (collectively, "Services"). The Platform is provided on a subscription basis after a free trial period.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">3. Account Registration</h2>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>You must provide accurate, complete, and current information during registration.</li>
          <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
          <li>You must be at least 18 years old and legally authorised to operate a food business.</li>
          <li>One account may be used for multiple outlets under the same subscription.</li>
          <li>You must notify us immediately at <a href="mailto:support@dine-verse.com" className="text-brand-600 hover:underline">support@dine-verse.com</a> of any unauthorised use of your account.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">4. Subscription & Payments</h2>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>A free trial is offered with full feature access. No credit card is required for the trial.</li>
          <li>After the trial, continued use requires a paid subscription.</li>
          <li>Payments are processed securely via Razorpay. DineVerse does not store your card or bank details.</li>
          <li>All prices are in Indian Rupees (INR) and inclusive of applicable taxes unless stated otherwise.</li>
          <li>Subscription fees are charged in advance for the selected billing period.</li>
          <li>Prices are subject to change with 30 days' prior notice via email.</li>
        </ul>
        <p className="mt-3">
          For our complete refund and cancellation policy, see our{' '}
          <Link to="/refund" className="text-brand-600 hover:underline">Refund Policy</Link>.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">5. Owner Responsibilities</h2>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>You are solely responsible for the accuracy of your menu, pricing, and business information.</li>
          <li>You are responsible for maintaining valid FSSAI, GSTIN, and other regulatory licences required for your food business.</li>
          <li>DineVerse is a software tool — it does not participate in any transaction between you and your customers. You are the merchant of record for all orders placed through your café page.</li>
          <li>You must not use the Platform for any illegal, fraudulent, or harmful purpose.</li>
          <li>You must not upload content that infringes intellectual property rights or is defamatory, obscene, or harmful.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">6. Customer Orders</h2>
        <p>
          Orders placed by customers via DineVerse are between the customer and the restaurant/café owner.
          DineVerse facilitates the order flow but is not liable for order fulfilment, food quality, delivery,
          or disputes arising between customers and owners. Café owners are responsible for resolving
          customer complaints related to their orders.
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
          it at any time using the built-in export feature.
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
          <li>We may suspend or terminate accounts that violate these Terms, engage in fraudulent activity, or fail to pay subscription fees after due notice.</li>
          <li>Upon termination, your data is retained for 30 days to allow export, after which it is permanently deleted subject to legal retention obligations.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">11. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by applicable law, DineVerse shall not be liable for any
          indirect, incidental, special, or consequential damages arising from your use of the Platform,
          including loss of revenue, data loss, or business interruption. Our total aggregate liability
          is limited to the subscription fees paid by you in the 3 months preceding the claim.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">12. Governing Law & Dispute Resolution</h2>
        <p>
          These Terms are governed by the laws of India. Any disputes shall first be attempted to be
          resolved through mutual negotiation. If unresolved, disputes shall be subject to the exclusive
          jurisdiction of the courts in Mumbai, Maharashtra, India.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">13. Changes to Terms</h2>
        <p>
          We may update these Terms from time to time. Continued use of the Platform after changes
          constitutes acceptance of the revised Terms. We will notify you of material changes by email
          or in-app notice at least 7 days in advance.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">14. Contact</h2>
        <p>
          For questions about these Terms, contact us at{' '}
          <a href="mailto:legal@dine-verse.com" className="text-brand-600 hover:underline">legal@dine-verse.com</a>{' '}
          or visit our <Link to="/contact" className="text-brand-600 hover:underline">Contact Us</Link> page.
        </p>
      </section>

    </LegalLayout>
  );
}
