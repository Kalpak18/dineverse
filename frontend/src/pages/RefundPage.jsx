import { Link } from 'react-router-dom';
import LegalLayout from '../components/LegalLayout';

export default function RefundPage() {
  return (
    <LegalLayout title="Refund & Cancellation Policy" updated="April 2025">

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">1. Overview</h2>
        <p>
          This Refund & Cancellation Policy applies to subscription payments made to DineVerse for access
          to the platform. It also clarifies our role with respect to customer orders placed through
          DineVerse-powered café pages.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">2. Free Trial</h2>
        <p>
          DineVerse offers a free trial period with full feature access. No payment is required during
          the trial period. No refund is applicable for the free trial as no charges are made.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">3. Subscription Cancellation</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            You may cancel your DineVerse subscription at any time by contacting us at{' '}
            <a href="mailto:support@dine-verse.com" className="text-brand-600 hover:underline">support@dine-verse.com</a>.
          </li>
          <li>
            Upon cancellation, your account remains active until the end of the current paid billing period.
            No further charges will be made after that date.
          </li>
          <li>
            You may export all your business data (menu items, orders, customer records) before or within
            30 days of cancellation. After 30 days, data is permanently deleted.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">4. Refund Policy for Subscriptions</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Annual plans:</strong> Refunds may be considered on a pro-rata basis if requested
            within 7 days of the initial subscription payment, provided the platform has not been
            actively used (no orders received, no menu published). Requests after 7 days are generally
            not eligible for a refund.
          </li>
          <li>
            <strong>Service interruption:</strong> If DineVerse experiences unplanned downtime exceeding
            24 consecutive hours in a billing month, eligible subscribers may request a pro-rata credit
            for the affected period.
          </li>
          <li>
            <strong>Duplicate charges:</strong> If you are charged more than once due to a technical error,
            the duplicate charge will be refunded in full within 7 working days.
          </li>
          <li>
            Refunds are not provided for partial months, unused features, or change-of-mind cancellations
            after the 7-day window.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">5. How to Request a Refund</h2>
        <p>To request a refund, please:</p>
        <ol className="list-decimal pl-5 mt-2 space-y-1.5">
          <li>Email us at <a href="mailto:support@dine-verse.com" className="text-brand-600 hover:underline">support@dine-verse.com</a> with the subject line "Refund Request".</li>
          <li>Include your registered email address, the date of payment, and the reason for the refund request.</li>
          <li>Attach your payment confirmation or Razorpay transaction ID if available.</li>
        </ol>
        <p className="mt-3">
          We will acknowledge your request within 2 working days and process eligible refunds within
          7–10 working days to the original payment method. Razorpay may take an additional 5–7 working
          days to credit the amount to your account depending on your bank.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">6. Customer Orders (Food Orders via Café Pages)</h2>
        <p>
          DineVerse is a technology platform that enables cafés and restaurants to manage orders. <strong>DineVerse
          is not the seller of food or any physical goods.</strong> Orders placed by customers through a
          café's DineVerse page are between the customer and the respective café owner.
        </p>
        <ul className="list-disc pl-5 mt-3 space-y-1.5">
          <li>Refunds for food orders (incorrect items, unsatisfactory quality, non-delivery) must be requested directly from the café owner.</li>
          <li>DineVerse is not liable for order fulfilment, food quality, or disputes between customers and café owners.</li>
          <li>If a customer believes a café is operating fraudulently through DineVerse, they may report it to us at <a href="mailto:support@dine-verse.com" className="text-brand-600 hover:underline">support@dine-verse.com</a> and we will investigate.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">7. Payment Processing</h2>
        <p>
          All subscription payments are processed securely via Razorpay. DineVerse does not store your
          card, UPI, or net banking credentials. In the event of a payment failure, the amount is
          typically auto-refunded by Razorpay within 5–7 working days. For payment-related disputes,
          you may also contact Razorpay support directly.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">8. Changes to this Policy</h2>
        <p>
          We may update this Refund Policy from time to time. Changes will be notified via email or
          in-app notice. Continued use of the Platform after the effective date of changes constitutes
          your acceptance of the revised policy.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">9. Contact</h2>
        <p>
          For any refund or cancellation queries, contact us at{' '}
          <a href="mailto:support@dine-verse.com" className="text-brand-600 hover:underline">support@dine-verse.com</a>{' '}
          or visit our <Link to="/contact" className="text-brand-600 hover:underline">Contact Us</Link> page.
          We aim to respond to all queries within 2 working days.
        </p>
      </section>

    </LegalLayout>
  );
}
