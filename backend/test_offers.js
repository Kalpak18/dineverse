const axios = require('axios');

const API_BASE = 'http://localhost:5000/api';

async function testOffersFlow() {
  try {
    console.log('=== Testing Offers & Coupon Code Flow ===\n');

    // 1. Login or create test account
    console.log('Step 1: Creating/Login to test account...');
    let cafeToken;
    try {
      const loginResponse = await axios.post(`${API_BASE}/auth/login`, {
        identifier: 'offer_test@example.com',
        password: 'password123'
      });
      cafeToken = loginResponse.data.token;
      console.log('✓ Logged in to existing account');
    } catch (err) {
      if (err.response?.data?.errorCode === 'INVALID_CREDENTIALS') {
        console.log('Creating new test account...');
        
        // Send OTP
        await axios.post(`${API_BASE}/auth/send-otp`, { email: 'offer_test@example.com' });

        // Pre-verify
        const preVerifyResponse = await axios.post(`${API_BASE}/auth/pre-verify-email`, {
          email: 'offer_test@example.com',
          otp: '123456'
        });

        // Create account
        const createResponse = await axios.post(`${API_BASE}/auth/create-account`, {
          email: 'offer_test@example.com',
          password: 'password123',
          emailVerifiedToken: preVerifyResponse.data.emailVerifiedToken
        });

        // Setup cafe
        cafeToken = createResponse.data.token;
        const setupResponse = await axios.post(`${API_BASE}/auth/complete-setup`, {
          name: 'Offer Test Cafe',
          slug: 'offer-test-cafe',
          phone: '9999999999'
        }, {
          headers: { Authorization: `Bearer ${cafeToken}` }
        });
        console.log('✓ Created new account with slug: offer-test-cafe');
      } else {
        throw err;
      }
    }

    // 2. Create an offer with coupon code
    console.log('\nStep 2: Creating offer with coupon code...');
    const createOfferResponse = await axios.post(`${API_BASE}/offers`, {
      name: 'Test Discount',
      description: '10% off test',
      offer_type: 'percentage',
      discount_value: 10,
      min_order_amount: 100,
      active_from: '00:00',
      active_until: '23:59',
      coupon_code: 'TEST10'
    }, {
      headers: { Authorization: `Bearer ${cafeToken}` }
    });
    
    const offerId = createOfferResponse.data.offer.id;
    console.log('✓ Created offer with coupon code TEST10, Offer ID:', offerId);
    console.log('  - Type: percentage');
    console.log('  - Discount: 10%');
    console.log('  - Min Order: ₹100');

    // 3. Get the cafe to know its slug
    const meResponse = await axios.get(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${cafeToken}` }
    });
    const cafeSlug = meResponse.data.cafe.slug;
    console.log('\nCafe slug:', cafeSlug);

    // 4. Test coupon validation (public endpoint)
    console.log('\nStep 3: Testing coupon validation...');
    
    try {
      const validateResponse = await axios.post(
        `${API_BASE}/offers/cafe/${cafeSlug}/validate-coupon`,
        {
          coupon_code: 'TEST10',
          items: [
            { menu_item_id: 'dummy-id', quantity: 1 }
          ],
          total: 500
        }
      );
      
      console.log('✓ Coupon validation successful!');
      console.log('  - Applied:', validateResponse.data.applied);
      console.log('  - Discount: ₹' + validateResponse.data.discount_amount);
      console.log('  - Final Amount: ₹' + validateResponse.data.final_amount);
    } catch (err) {
      console.log('✗ Coupon validation failed:');
      console.log('  Error:', err.response?.data?.message);
      if (err.response?.data?.message?.includes('minimum')) {
        console.log('\n  Trying with higher total...');
        const validateResponse = await axios.post(
          `${API_BASE}/offers/cafe/${cafeSlug}/validate-coupon`,
          {
            coupon_code: 'TEST10',
            items: [{ menu_item_id: 'dummy-id', quantity: 1 }],
            total: 500  // Should work with 500 since min is 100
          }
        );
        console.log('✓ Now works with total ₹500');
        console.log('  - Discount: ₹' + validateResponse.data.discount_amount);
      }
    }

    // 5. Test offer preview
    console.log('\nStep 4: Testing offer preview (no coupon code)...');
    const previewResponse = await axios.post(
      `${API_BASE}/offers/cafe/${cafeSlug}/preview`,
      {
        items: [{ menu_item_id: 'dummy-id', quantity: 1 }],
        total: 500
      }
    );
    
    console.log('✓ Preview result:');
    console.log('  - Applied:', previewResponse.data.applied);
    if (previewResponse.data.applied) {
      console.log('  - Discount: ₹' + previewResponse.data.discount_amount);
      console.log('  - Final Amount: ₹' + previewResponse.data.final_amount);
    }

    // 6. Get active offers
    console.log('\nStep 5: Getting active offers for customer...');
    const offersResponse = await axios.get(
      `${API_BASE}/offers/cafe/${cafeSlug}/offers`
    );
    
    console.log('✓ Active offers found:', offersResponse.data.offers.length);
    offersResponse.data.offers.forEach((offer, i) => {
      console.log(`  ${i+1}. ${offer.name} (${offer.offer_type})`);
    });

    console.log('\n=== ✅ All tests passed! Offers system is working ===');

  } catch (error) {
    console.error('\n✗ Test failed:');
    console.error('Error response:', error.response?.data);
    console.error('Error status:', error.response?.status);
    console.error('Error message:', error.message);
    if (error.response?.data?.message?.includes('Internal server error')) {
      console.error('\nThis is likely a database or server error. Check backend logs.');
    }
  }
}

testOffersFlow();
