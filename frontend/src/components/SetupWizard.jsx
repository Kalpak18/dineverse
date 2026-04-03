import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const SETUP_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to DineVerse! 🎉',
    icon: '👋',
    description: 'Let\'s get your café ready to receive orders',
  },
  {
    id: 'profile',
    title: 'Set Up Your Profile',
    icon: '🎨',
    description: 'Add logo, cover image, and cafe details',
  },
  {
    id: 'menu',
    title: 'Build Your Menu',
    icon: '🍽️',
    description: 'Add categories and menu items with photos',
  },
  {
    id: 'share',
    title: 'Share with Customers',
    icon: '📱',
    description: 'Get your unique customer link & QR code',
  },
  {
    id: 'ready',
    title: 'You\'re Ready! 🚀',
    icon: '✨',
    description: 'Start receiving orders',
  },
];

export default function SetupWizard({ onComplete }) {
  const { cafe } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState({});

  const currentStep = SETUP_STEPS[step];

  const markComplete = () => {
    setCompleted((prev) => ({ ...prev, [currentStep.id]: true }));
    if (step < SETUP_STEPS.length - 1) {
      setStep(step + 1);
    }
  };

  const skipStep = () => {
    if (step < SETUP_STEPS.length - 1) {
      setStep(step + 1);
    }
  };

  const handleDone = () => {
    onComplete?.();
    navigate('/owner/dashboard');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-brand-500 to-orange-500 text-white px-6 py-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <span>{currentStep.icon}</span>
            {currentStep.title}
          </h2>
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="text-white/80 hover:text-white text-xl"
            >
              ←
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="px-6 pt-4">
          <div className="flex gap-2">
            {SETUP_STEPS.map((s, i) => (
              <div
                key={s.id}
                className={`flex-1 h-2 rounded-full transition-colors ${
                  i <= step ? 'bg-brand-500' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Step {step + 1} of {SETUP_STEPS.length}
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-8 space-y-6">
          <p className="text-gray-600">{currentStep.description}</p>

          {step === 0 && <StepWelcome cafeSlug={cafe?.slug} />}
          {step === 1 && <StepProfile />}
          {step === 2 && <StepMenu />}
          {step === 3 && <StepShare cafeSlug={cafe?.slug} />}
          {step === 4 && <StepReady />}
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex gap-3 sticky bottom-0 bg-gray-50 border-t border-gray-100 pt-4">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="btn-secondary flex-1"
            >
              ← Back
            </button>
          )}
          {step < SETUP_STEPS.length - 1 && (
            <>
              <button
                onClick={skipStep}
                className="btn-secondary flex-1"
              >
                Skip
              </button>
              <button
                onClick={markComplete}
                className="btn-primary flex-1"
              >
                Next →
              </button>
            </>
          )}
          {step === SETUP_STEPS.length - 1 && (
            <button
              onClick={handleDone}
              className="btn-primary flex-1 text-lg"
            >
              Go to Dashboard 🚀
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepWelcome({ cafeSlug }) {
  return (
    <div className="space-y-4">
      <div className="bg-brand-50 border border-brand-200 rounded-xl p-4">
        <p className="text-sm text-brand-900">
          <strong>Your café is registered!</strong> Now let's set it up in 4 simple steps.
        </p>
      </div>
      <div className="space-y-3">
        <h4 className="font-semibold text-gray-800">What you'll do:</h4>
        <ul className="space-y-2 text-sm text-gray-600">
          <li className="flex gap-2">
            <span>1. 🎨</span>
            <span>Upload your café logo & cover photo</span>
          </li>
          <li className="flex gap-2">
            <span>2. 🍽️</span>
            <span>Add menu categories and items with prices</span>
          </li>
          <li className="flex gap-2">
            <span>3. 📱</span>
            <span>Get your customer link to share</span>
          </li>
          <li className="flex gap-2">
            <span>4. 📦</span>
            <span>Start receiving orders with notifications!</span>
          </li>
        </ul>
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mt-4">
        <p className="text-xs text-blue-900">
          <strong>💡 Tip:</strong> Each step takes 5-10 minutes. You can skip any and come back later!
        </p>
      </div>
    </div>
  );
}

function StepProfile() {
  return (
    <div className="space-y-4">
      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
        <div>
          <h4 className="font-semibold text-gray-800 mb-2">📸 Upload Images</h4>
          <p className="text-sm text-gray-600">
            Add a <strong>Logo</strong> (square, 400×400px) and <strong>Cover Photo</strong> (wide, 1600×900px)
          </p>
        </div>
        <div>
          <h4 className="font-semibold text-gray-800 mb-2">📝 Add Details</h4>
          <p className="text-sm text-gray-600">
            Fill in your café description, phone, and address so customers know more about you.
          </p>
        </div>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
        <p className="text-xs text-yellow-900">
          <strong>⏭️ Next:</strong> Click on <strong>⚙️ Profile</strong> in the left sidebar and upload your images.
        </p>
      </div>
    </div>
  );
}

function StepMenu() {
  return (
    <div className="space-y-4">
      <div className="bg-gray-50 rounded-xl p-4 space-y-4">
        <div>
          <h4 className="font-semibold text-gray-800 mb-2">1️⃣ Create Categories (Optional)</h4>
          <p className="text-sm text-gray-600 mb-2">
            Example: Momos, Pizza, Beverages, Desserts
          </p>
          <p className="text-xs text-gray-500 italic">
            Click <strong>+ Add Category</strong> in the Menu tab
          </p>
        </div>

        <hr />

        <div>
          <h4 className="font-semibold text-gray-800 mb-2">2️⃣ Add Menu Items</h4>
          <p className="text-sm text-gray-600 space-y-1 flex flex-col">
            <span>• Select <strong>🟢 Veg</strong> or <strong>🔴 Non-Veg</strong></span>
            <span>• Pick a category (or create one inline)</span>
            <span>• Enter name, price, description</span>
            <span>• Upload a photo</span>
            <span>• Check "Available for order"</span>
          </p>
        </div>
      </div>

      <div className="bg-green-50 border border-green-200 rounded-xl p-3 space-y-2">
        <p className="text-xs text-green-900">
          <strong>✨ Pro tip:</strong> Start with 10-15 items, add more later as you go.
        </p>
        <p className="text-xs text-green-900">
          <strong>📸 Images matter:</strong> Clear food photos get more orders!
        </p>
      </div>
    </div>
  );
}

function StepShare({ cafeSlug }) {
  const customerLink = `${window.location.origin}/cafe/${cafeSlug}`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(customerLink);
    toast.success('Link copied!');
  };

  const generateQRCode = () => {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(customerLink)}`;
    window.open(qrUrl, '_blank');
  };

  return (
    <div className="space-y-4">
      <div className="bg-gray-50 rounded-xl p-4 space-y-4">
        <div>
          <h4 className="font-semibold text-gray-800 mb-3">Your Customer Link</h4>
          <div className="bg-white border-2 border-brand-300 rounded-lg p-3 flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={customerLink}
              className="flex-1 bg-transparent text-sm font-mono text-gray-700 outline-none"
            />
            <button
              onClick={copyToClipboard}
              className="text-xs px-3 py-1.5 bg-brand-500 text-white rounded-lg hover:bg-brand-600 whitespace-nowrap"
            >
              Copy
            </button>
          </div>
        </div>

        <hr />

        <div>
          <h4 className="font-semibold text-gray-800 mb-2">📤 Share With Customers</h4>
          <div className="space-y-2 text-sm text-gray-600">
            <p>✅ Send via WhatsApp to regular customers</p>
            <p>✅ Print on table menus & receipts</p>
            <p>✅ Generate & print a QR code</p>
            <p>✅ Post on social media / Google Business</p>
            <button
              onClick={generateQRCode}
              className="text-xs px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 mt-2"
            >
              🔗 Generate QR Code
            </button>
          </div>
        </div>
      </div>

      <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
        <p className="text-xs text-purple-900">
          <strong>💡 Tip:</strong> Customize your slug in the Profile page if you want a shorter link!
        </p>
      </div>
    </div>
  );
}

function StepReady() {
  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-300 rounded-xl p-6 text-center space-y-4">
        <div className="text-5xl">🎉</div>
        <h3 className="text-xl font-bold text-gray-900">You're All Set!</h3>
        <p className="text-gray-700">
          Your café is live and ready to receive orders from customers.
        </p>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
        <h4 className="font-semibold text-gray-800">Next Steps:</h4>
        <ul className="space-y-2 text-sm text-gray-600">
          <li className="flex gap-2">
            <span>1. 👂</span>
            <span>Keep the <strong>📋 Orders</strong> page open during service</span>
          </li>
          <li className="flex gap-2">
            <span>2. 🔔</span>
            <span>Listen for notification beeps when orders arrive</span>
          </li>
          <li className="flex gap-2">
            <span>3. ⬆️</span>
            <span>Update order status as you prepare (Pending → Served)</span>
          </li>
          <li className="flex gap-2">
            <span>4. 📊</span>
            <span>Check <strong>Dashboard</strong> for daily stats & top items</span>
          </li>
        </ul>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
        <p className="text-xs text-blue-900">
          <strong>📖 Need help?</strong> Check the full guide at <strong>CAFE_OWNER_GUIDE.md</strong>
        </p>
      </div>

      <button
        onClick={() => window.open('CAFE_OWNER_GUIDE.md', '_blank')}
        className="btn-secondary w-full text-sm"
      >
        📖 View Full Guide
      </button>
    </div>
  );
}
