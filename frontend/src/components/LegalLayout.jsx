import { Link } from 'react-router-dom';
import DineLogo from './DineLogo';

const LINKS = [
  { to: '/terms',   label: 'Terms & Conditions' },
  { to: '/privacy', label: 'Privacy Policy' },
  { to: '/refund',  label: 'Refund Policy' },
  { to: '/contact', label: 'Contact Us' },
];

export default function LegalLayout({ title, updated = 'April 2025', children }) {
  return (
    <div className="min-h-screen bg-white">
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link to="/"><DineLogo size="sm" /></Link>
          <div className="hidden sm:flex gap-4 text-xs text-gray-500">
            {LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="hover:text-gray-900 transition-colors">{l.label}</Link>
            ))}
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">{title}</h1>
        <p className="text-sm text-gray-400 mb-10">Last updated: {updated}</p>

        <div className="prose prose-gray max-w-none space-y-8 text-gray-700 text-sm leading-relaxed">
          {children}
        </div>

        <div className="mt-12 pt-8 border-t border-gray-100">
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between text-sm text-gray-400">
            <span>© 2025 DineVerse. All rights reserved.</span>
            <div className="flex flex-wrap gap-4 justify-center">
              {LINKS.map((l) => (
                <Link key={l.to} to={l.to} className="hover:text-gray-700 transition-colors">{l.label}</Link>
              ))}
              <Link to="/" className="hover:text-gray-700">Home</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
