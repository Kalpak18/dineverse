require('dotenv').config();
const axios = require('axios');

const API_BASE = 'http://localhost:5000/api';

(async () => {
  try {
    console.log('Testing public API endpoint (no auth required)...\n');
    
    // Test 1: Get public emoji map (this is called by MenuPage)
    console.log('1. Testing GET /admin/public-settings/category_emoji_map');
    try {
      const emojiRes = await axios.get(`${API_BASE}/admin/public-settings/category_emoji_map`, {
        timeout: 5000
      });
      
      if (emojiRes.status === 200 && emojiRes.data.value) {
        const emojiCount = Object.keys(emojiRes.data.value).length;
        console.log(`   ✓ Success (${emojiCount} emojis)`);
        console.log(`   Sample: ${JSON.stringify(Object.entries(emojiRes.data.value).slice(0, 3))}\n`);
      } else {
        console.log(`   ✗ Unexpected response: ${JSON.stringify(emojiRes.data)}\n`);
      }
    } catch (err) {
      if (err.code === 'ECONNREFUSED') {
        console.log('   ⚠ Cannot connect to backend (not running yet)');
        console.log('   Start backend with: npm start\n');
      } else {
        console.log(`   ✗ Error: ${err.message}\n`);
      }
    }
    
    // Test 2: Get public announcement (should be empty/inactive)
    console.log('2. Testing GET /admin/public-settings/announcement');
    try {
      const announceRes = await axios.get(`${API_BASE}/admin/public-settings/announcement`, {
        timeout: 5000
      });
      
      if (announceRes.status === 200) {
        console.log(`   ✓ Success`);
        console.log(`   Value: ${JSON.stringify(announceRes.data.value)}\n`);
      }
    } catch (err) {
      if (err.code !== 'ECONNREFUSED') {
        console.log(`   ✗ Error: ${err.message}\n`);
      }
    }
    
    console.log('API tests complete. Backend must be running for full verification.');
    console.log('\nTo start the full system:');
    console.log('  Backend:  cd backend && npm start');
    console.log('  Frontend: cd frontend && npm run dev');
    
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
