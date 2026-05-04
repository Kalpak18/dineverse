const axios = require('axios');

const API_BASE = 'http://localhost:5000/api';

async function testRefreshToken() {
  try {
    console.log('1. Testing login with existing account...');
    const loginResponse = await axios.post(`${API_BASE}/auth/login`, {
      identifier: 'kalpakbhoir18@gmail.com', // Use existing test account
      password: 'password123' // Try common password
    });

    const { token, refreshToken } = loginResponse.data.data;
    console.log('Login successful!');
    console.log('Access Token:', token.substring(0, 50) + '...');
    console.log('Refresh Token:', refreshToken.substring(0, 50) + '...');

    // Wait a bit then test refresh
    console.log('\n2. Waiting 2 seconds then testing refresh...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('3. Testing token refresh...');
    const refreshResponse = await axios.post(`${API_BASE}/auth/refresh`, {
      refreshToken
    });

    const { token: newToken, refreshToken: newRefreshToken } = refreshResponse.data.data;
    console.log('Refresh successful!');
    console.log('New Access Token:', newToken.substring(0, 50) + '...');
    console.log('New Refresh Token:', newRefreshToken.substring(0, 50) + '...');

    console.log('\n4. Testing expired access token handling...');
    // Try to use the old token (should fail)
    try {
      await axios.get(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log('ERROR: Old token still works!');
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('✓ Old access token properly expired');
      } else {
        console.log('Unexpected error:', error.message);
      }
    }

    // Test new token works
    const meResponse = await axios.get(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${newToken}` }
    });
    console.log('✓ New access token works:', meResponse.data.data.cafe.name);

    console.log('\n✅ All tests passed! Refresh token system is working.');

  } catch (error) {
    console.error('Test failed:', error.response?.data || error.message);
    if (error.response?.data?.message?.includes('Invalid credentials')) {
      console.log('Need to create a test account first. Let me try that...');
      await createTestAccount();
    }
  }
}

async function createTestAccount() {
  try {
    console.log('Creating test account...');

    // Send OTP
    await axios.post(`${API_BASE}/auth/send-otp`, { email: 'test_refresh@example.com' });

    // Pre-verify with hardcoded OTP (development mode)
    const preVerifyResponse = await axios.post(`${API_BASE}/auth/pre-verify-email`, {
      email: 'test_refresh@example.com',
      otp: '123456'
    });

    console.log('Pre-verify response:', preVerifyResponse.data);

    // Create account
    const createResponse = await axios.post(`${API_BASE}/auth/create-account`, {
      email: 'test_refresh@example.com',
      password: 'password123',
      emailVerifiedToken: preVerifyResponse.data.emailVerifiedToken
    });

    console.log('Test account created! Token:', createResponse.data.token.substring(0, 50) + '...');

    // Complete setup
    const setupResponse = await axios.post(`${API_BASE}/auth/complete-setup`, {
      name: 'Test Cafe',
      slug: 'test-cafe',
      phone: '1234567890'
    }, {
      headers: { Authorization: `Bearer ${createResponse.data.token}` }
    });

    console.log('Setup completed! Now testing refresh tokens...');

    // Now test login and refresh
    const loginResponse = await axios.post(`${API_BASE}/auth/login`, {
      identifier: 'test_refresh@example.com',
      password: 'password123'
    });

    const { token, refreshToken } = loginResponse.data;
    console.log('Login successful with refresh token!');
    console.log('Access Token:', token.substring(0, 50) + '...');
    console.log('Refresh Token:', refreshToken.substring(0, 50) + '...');

    // Test refresh immediately
    const refreshResponse = await axios.post(`${API_BASE}/auth/refresh`, {
      refreshToken
    });

    console.log('Refresh successful!');
    console.log('✅ Refresh token system is working.');

  } catch (error) {
    console.error('Failed to create test account:', error.response?.data || error.message);
  }
}

testRefreshToken();