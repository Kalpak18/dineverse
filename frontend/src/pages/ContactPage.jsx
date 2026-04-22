import { Link } from 'react-router-dom';
import LegalLayout from '../components/LegalLayout';

export default function ContactPage() {
  return (
    <LegalLayout title="Contact Us" updated="April 2025">

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">Get in Touch</h2>
        <p>
          We're here to help. Whether you have a question about your account, need technical support,
          want to report an issue, or have a general inquiry, reach out to us using the details below.
          We aim to respond to all queries within 2 working days.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-3">Contact Details</h2>

        <div className="grid gap-4 sm:grid-cols-2">

          <div className="bg-gray-50 rounded-2xl p-5">
            <div className="text-2xl mb-2">📧</div>
            <h3 className="font-bold text-gray-900 mb-1">General Support</h3>
            <p className="text-xs text-gray-500 mb-2">Account, billing, technical issues</p>
            <a href="mailto:support@dine-verse.com" className="text-brand-600 font-medium hover:underline text-sm">
              support@dine-verse.com
            </a>
          </div>

          <div className="bg-gray-50 rounded-2xl p-5">
            <div className="text-2xl mb-2">⚖️</div>
            <h3 className="font-bold text-gray-900 mb-1">Legal & Privacy</h3>
            <p className="text-xs text-gray-500 mb-2">Privacy requests, legal matters</p>
            <a href="mailto:legal@dine-verse.com" className="text-brand-600 font-medium hover:underline text-sm">
              legal@dine-verse.com
            </a>
          </div>

          <div className="bg-gray-50 rounded-2xl p-5">
            <div className="text-2xl mb-2">💳</div>
            <h3 className="font-bold text-gray-900 mb-1">Refund Requests</h3>
            <p className="text-xs text-gray-500 mb-2">Payment issues, refund queries</p>
            <a href="mailto:support@dine-verse.com" className="text-brand-600 font-medium hover:underline text-sm">
              support@dine-verse.com
            </a>
          </div>

          <div className="bg-gray-50 rounded-2xl p-5">
            <div className="text-2xl mb-2">🌐</div>
            <h3 className="font-bold text-gray-900 mb-1">Website</h3>
            <p className="text-xs text-gray-500 mb-2">Visit our platform</p>
            <a href="https://dine-verse.com" className="text-brand-600 font-medium hover:underline text-sm">
              dine-verse.com
            </a>
          </div>

        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-3">Business Information</h2>
        <div className="bg-gray-50 rounded-2xl p-5 space-y-2 text-sm">
          <div className="flex gap-2">
            <span className="text-gray-500 w-32 shrink-0">Business Name</span>
            <span className="font-medium text-gray-900">DineVerse</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-500 w-32 shrink-0">Website</span>
            <a href="https://dine-verse.com" className="text-brand-600 hover:underline">dine-verse.com</a>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-500 w-32 shrink-0">Email</span>
            <a href="mailto:support@dine-verse.com" className="text-brand-600 hover:underline">support@dine-verse.com</a>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-500 w-32 shrink-0">Country</span>
            <span className="text-gray-900">India</span>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-3">Grievance Officer</h2>
        <p className="mb-3">
          In accordance with the Information Technology Act, 2000 and the Information Technology
          (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, we have designated
          a Grievance Officer to address complaints and concerns:
        </p>
        <div className="bg-brand-50 rounded-2xl p-5 space-y-2 text-sm border border-brand-100">
          <div className="flex gap-2">
            <span className="text-gray-500 w-32 shrink-0">Name</span>
            <span className="font-semibold text-gray-900">Kalpak Bhoir</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-500 w-32 shrink-0">Designation</span>
            <span className="text-gray-900">Grievance Officer</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-500 w-32 shrink-0">Email</span>
            <a href="mailto:legal@dine-verse.com" className="text-brand-600 hover:underline">legal@dine-verse.com</a>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-500 w-32 shrink-0">Response time</span>
            <span className="text-gray-900">Within 15 working days</span>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">Response Times</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left p-3 font-semibold text-gray-900 rounded-tl-lg">Query Type</th>
                <th className="text-left p-3 font-semibold text-gray-900 rounded-tr-lg">Response Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr><td className="p-3 text-gray-700">General support</td><td className="p-3 text-gray-700">Within 2 working days</td></tr>
              <tr><td className="p-3 text-gray-700">Billing & refund queries</td><td className="p-3 text-gray-700">Within 2 working days</td></tr>
              <tr><td className="p-3 text-gray-700">Privacy & data requests</td><td className="p-3 text-gray-700">Within 30 days</td></tr>
              <tr><td className="p-3 text-gray-700">Grievance complaints</td><td className="p-3 text-gray-700">Within 15 working days</td></tr>
              <tr><td className="p-3 text-gray-700">Security incidents</td><td className="p-3 text-gray-700">Within 24 hours</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-2">Related Policies</h2>
        <div className="flex flex-wrap gap-3">
          <Link to="/terms" className="px-4 py-2 bg-gray-50 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors border border-gray-200">
            Terms & Conditions
          </Link>
          <Link to="/privacy" className="px-4 py-2 bg-gray-50 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors border border-gray-200">
            Privacy Policy
          </Link>
          <Link to="/refund" className="px-4 py-2 bg-gray-50 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors border border-gray-200">
            Refund Policy
          </Link>
        </div>
      </section>

    </LegalLayout>
  );
}
