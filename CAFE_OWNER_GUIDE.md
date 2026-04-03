# 🍽️ DineVerse Platform - Café Owner Setup Guide

Welcome! This guide will walk you through setting up your café on DineVerse and getting orders from customers.

---

## 📋 Table of Contents
1. [Initial Registration](#registration)
2. [Café Profile Setup](#profile)
3. [Adding Menu Items](#menu)
4. [Managing Orders](#orders)
5. [Sharing with Customers](#sharing)
6. [Dashboard & Analytics](#dashboard)

---

## <a id="registration"></a>Step 1: Register Your Café 📝

### 1.1 Go to Registration Page
Open your browser and visit: `http://yourapp.com/owner/register`

**You'll see this screen:**
- Enter your **Café Name** (e.g., "The Coffee House")
- The **URL Slug** auto-generates from your name (e.g., "the-coffee-house")
- This slug becomes your unique customer link: `yourapp.com/cafe/the-coffee-house`

### 1.2 Fill Registration Form

| Field | Example | Notes |
|-------|---------|-------|
| **Café Name** | The Coffee House | Required |
| **URL Slug** | the-coffee-house | Auto-generated, only lowercase & hyphens |
| **Email** | owner@cafehouse.com | For login, keep secure |
| **Password** | MySecret123 | Min 6 characters |
| **Description** | Cozy café with artisan coffee | Optional, shown to customers |
| **Phone** | +91 98765 43210 | Optional |
| **Address** | 123 Main Street, Mumbai | Optional |

### 1.3 Submit & Login
- Click **Create Café Account**
- You're automatically logged in
- You'll land on the **Dashboard**

---

## <a id="profile"></a>Step 2: Set Up Your Café Profile 🎨

### 2.1 Go to Profile Settings
In the left sidebar, click **⚙️ Profile**

### 2.2 Upload Logo & Cover Image

#### Logo (Square 1:1)
- Click the upload box
- Select a clean, square image (PNG/JPG, max 5MB)
- **Good size:** 400×400px
- **Good examples:** Your café logo, icon, initials
- Drag & drop or click to browse

#### Cover Image (Wide 16:9)
- Click the second upload box
- Select a wide landscape image
- **Good size:** 1600×900px
- **Good examples:** Café interior, coffee setup, ambiance
- This appears on the customer menu page

### 2.3 Update Café Details
- **Description:** "Serving premium coffee & pastries since 2022"
- **Phone:** Customers can see this (optional)
- **Address:** Location info (optional)

### 2.4 Save
Click **Save Changes** button

**Result:** Your profile is now live on customer pages!

---

## <a id="menu"></a>Step 3: Build Your Menu 🍽️

### 3.1 Go to Menu Management
In the left sidebar, click **🍽️ Menu**

### 3.2 Create Categories First (Optional)

**Click:** *+ Add Category*

Categories organize your menu (e.g., Momos, Pizza, Desserts, Beverages)

| Field | Example |
|-------|---------|
| **Category Name** | Momos |

**Repeat for each category you want to create.** These will appear as collapsible sections.

---

### 3.3 Add Menu Items

**Click:** *+ Add Item*

You'll see this modal:

#### Select Food Type (Required)
- **🟢 Veg** — for vegetarian items
- **🔴 Non-Veg** — for non-vegetarian items

**Customers will filter by this first!**

#### Select Category (Optional)
Click on a category pill to assign the item to it.
- **+ New** button to create categories on-the-fly
- Type category name → Hit "Add" or press Enter

#### Add Item Details

| Field | Example | Notes |
|-------|---------|-------|
| **Item Name** | Veg Steamed Momos | Required |
| **Description** | Soft dumplings with veggie filling | Optional, shown to customers |
| **Price (₹)** | 80 | Required, required for billing |
| **Item Image** | [upload photo] | Drag & drop a square image |
| **Available for Order** | ✅ Checked | Uncheck to hide from customers |

#### Upload Item Image
- Click the upload box
- Select a clear photo of the dish
- **Good size:** 600×600px
- Shows as a small square in the menu

#### Save Item
Click **Save Item** button

**Repeat this for all your menu items!**

---

### 3.4 Example Menu Structure

```
🟢 VEG
└── Momos
    ├── Veg Steamed Momos ₹80 [✓ On]
    └── Veg Fried Momos ₹90 [✓ On]
└── Pizza
    └── Margherita ₹150 [✓ On]

🔴 NON-VEG
└── Momos
    ├── Chicken Momos ₹100 [✓ On]
    └── Prawn Momos ₹120 [✓ On]
```

**Note:** Categories are shared between Veg & Non-Veg (smart organization!)

---

### 3.5 Manage Items

**Edit an Item:**
- Click the item row → Click **Edit**
- Update any field → Click **Save Item**

**Hide an Item (Out of Stock):**
- Click the item → Click **Edit**
- Uncheck **"Available for order"** → **Save**
- It disappears from customer menu

**Delete an Item:**
- Click the item row → Click **Delete**
- Confirm when asked

---

## <a id="orders"></a>Step 4: Receive & Manage Orders 📦

### 4.1 Customer Places Order

When a customer:
1. Visits: `yourapp.com/cafe/your-slug`
2. Enters their name & table number
3. Adds items to cart
4. Clicks **"Place Order"**

**You instantly get:**
- 🔔 **Triple beep notification sound**
- 📬 **Toast notification** in your dashboard
- 📋 **Order appears at the top** (no refresh needed!)

---

### 4.2 Order Details

Each order shows:

```
#0001 [Order number]
John | Table 5 [Customer & Table]
🟡 Pending [Status badge]
₹350 [Total amount]
```

**Click the order to expand and see:**
- Item list with quantities
- Special instructions/notes
- Buttons to update status
- Cancel order option

---

### 4.3 Order Status Flow

When you click an order, you see status buttons:

| Status | Meaning | Next Step |
|--------|---------|-----------|
| **⏳ Pending** | Order just received | Confirm & start preparing |
| **✅ Confirmed** | You're preparing it | Click when you start making it |
| **👨‍🍳 Preparing** | Being cooked/assembled | Click when ready to serve |
| **🍽️ Served** | Given to customer | Final status |
| **❌ Cancelled** | Order cancelled | If customer changes mind |

**Example flow:**
```
Customer places order → You get notification
         ↓
You click "Mark as Confirmed" (accepting the order)
         ↓
Kitchen starts cooking
         ↓
You click "Mark as Preparing" (to tell customer it's being made)
         ↓
Food is ready
         ↓
You click "Mark as Served" (order complete!)
```

---

### 4.4 Filter Orders

At the top, click any status to filter:
- **All** — Show all orders
- **⏳ Pending (3)** — Only pending orders
- **✅ Confirmed** — Confirmed orders
- **👨‍🍳 Preparing** — Being prepared
- **🍽️ Served** — Completed orders
- **❌ Cancelled** — Cancelled orders

---

## <a id="sharing"></a>Step 5: Share with Customers 📱

### 5.1 Your Customer Link

Your unique customer ordering link is:

**`yourapp.com/cafe/your-slug`**

Example: `foodie-app.com/cafe/the-coffee-house`

### 5.2 How to Share

#### Option 1: Share Manually
Copy your link and:
- Send via WhatsApp to customers
- Print on receipts & table QR codes
- Post on social media
- Add to Google Business profile

#### Option 2: Generate QR Code
Create a QR code from your link:
1. Visit: `https://qr-server.com/api/qrcode?size=200x200&data=yourapp.com/cafe/your-slug`
2. Take a screenshot
3. Print & place on tables/door/menus

#### Option 3: Display on Dashboard
Your link appears in the **Dashboard** → Share it from there!

---

### 5.3 Customer Experience

When a customer opens your link:
1. Enter their name (e.g., "Rahul")
2. Enter table number (e.g., "Table 5")
3. Click "View Menu"
4. Browse by **🟢 Veg / 🔴 Non-Veg** tabs
5. Search for items
6. Add items with quantities
7. Review bill
8. Place order
9. Get digital receipt with order number

---

## <a id="dashboard"></a>Step 6: View Dashboard & Analytics 📊

### 6.1 Go to Dashboard
In the left sidebar, click **📊 Dashboard**

### 6.2 Today's Stats

**4 Cards showing:**
- 📋 **Today's Orders** — Total orders placed today
- 💰 **Today's Revenue** — Total money earned today
- ⏳ **Pending** — Orders waiting for you
- 👨‍🍳 **Preparing** — Orders being made

### 6.3 Recent Orders Table
Last 10 orders with:
- Order number
- Customer name & table
- Status
- Amount

**Click any row to expand** and see order items

### 6.4 Top Items Chart
Most popular items this week:
- Item name
- How many sold
- Revenue generated

Use this to:
- Know what's popular
- Stock up on popular items
- Promote bestsellers

---

## 🎯 Daily Workflow

### Morning
1. ☕ Open **Dashboard** → Check overnight orders (if any)
2. 🍽️ Go to **Menu** → Update available items
   - Toggle items "On/Off" as they run out
   - Add today's specials

### During Service
1. 📱 Keep phone/tablet open on **Orders** page
2. 👂 Listen for notification beep when orders arrive
3. 👀 Watch for real-time order updates
4. ⬆️ Update status as you prepare:
   - Pending → Confirmed → Preparing → Served
5. 🔔 Notifications tell customers their order status

### Evening
1. 📊 Check **Dashboard** for daily revenue
2. 🏆 See which items sold the most
3. 📝 Plan next day's menu based on popular items

---

## ❓ Troubleshooting

### Issue: Notification not playing
**Solution:**
- Check browser volume is not muted
- Try refreshing the page
- Modern browsers require user interaction first (just click anywhere on the page)

### Issue: Order not appearing real-time
**Solution:**
- Refresh the **Orders** page manually (↻ button)
- Check network connection is stable
- Restart the browser tab

### Issue: Customers say they can't see my menu
**Solution:**
- Check your café slug is correct in the link
- Make sure items are marked as "✓ Available for order"
- Verify at least one item exists

### Issue: Can't upload images
**Solution:**
- Check file size < 5MB
- Use PNG or JPG format only
- Try a different image
- Check internet connection

---

## 📧 Support

Having issues? Contact us:
- Email: support@foodie-app.com
- WhatsApp: +91 98765 43210
- Website: foodie-app.com/help

---

## ✨ Best Practices

### Menu
- ✅ Add clear, appetizing photos
- ✅ Keep descriptions short & enticing
- ✅ Update prices regularly
- ✅ Mark items unavailable (don't delete)

### Orders
- ✅ Update status quickly (customers see it in real-time)
- ✅ Add notes if there's a delay
- ✅ Serve as soon as status is "Preparing"

### Café Profile
- ✅ Use a clear logo (not blurry)
- ✅ Add a nice café photo as cover
- ✅ Include address for directions
- ✅ Add phone number for callbacks

---

**🎉 You're all set! Happy ordering!**

*Last updated: March 31, 2026*
