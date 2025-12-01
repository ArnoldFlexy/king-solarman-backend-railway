const express = require('express');
const cors = require('cors');
const app = express();

// Load PayPal credentials
const sandboxClientId = process.env.SANDBOX_PAYPAL_CLIENT_ID;
const sandboxClientSecret = process.env.SANDBOX_PAYPAL_CLIENT_SECRET;
const liveClientId = process.env.LIVE_PAYPAL_CLIENT_ID;
const liveClientSecret = process.env.LIVE_PAYPAL_CLIENT_SECRET;

// Configure CORS for both local development and production
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://king-solarman-frontend.vercel.app',
    'https://kingsolarman.co.bw'
  ],
  credentials: true
}));

app.use(express.json());

// In-memory storage (use database in production)
const orders = new Map();

// Verify PayPal webhook signature
const verifyPayPalWebhook = (req) => {
  // For now, we'll trust the webhook since we're testing
  // In production, implement proper verification:
  // https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature
  
  const paypalSignature = req.headers['paypal-transmission-id'];
  const paypalCertUrl = req.headers['paypal-cert-url'];
  const paypalAuthAlgo = req.headers['paypal-auth-algo'];
  const paypalTransmissionSig = req.headers['paypal-transmission-sig'];
  const paypalTransmissionTime = req.headers['paypal-transmission-time'];
  
  console.log('🔐 PayPal Webhook Headers:', {
    transmissionId: paypalSignature ? '✅ Present' : '❌ Missing',
    certUrl: paypalCertUrl ? '✅ Present' : '❌ Missing',
    authAlgo: paypalAuthAlgo ? '✅ Present' : '❌ Missing'
  });
  
  return true; // Skip verification for testing
};

// PayPal Webhook endpoint
app.post('/api/webhook/paypal', (req, res) => {
  try {
    // Verify webhook signature (optional for testing)
    const isValid = verifyPayPalWebhook(req);
    if (!isValid) {
      console.warn('⚠️ Webhook verification skipped (testing mode)');
    }
    
    const webhookData = req.body;
    console.log('🔔 PayPal Webhook Received:', webhookData.event_type);

    const eventType = webhookData.event_type;
    const resource = webhookData.resource || {};
    
    // Extract order ID
    let orderId;
    if (resource.supplementary_data?.related_ids?.order_id) {
      orderId = resource.supplementary_data.related_ids.order_id;
    } else if (resource.purchase_units?.[0]?.payments?.captures?.[0]?.id) {
      orderId = resource.purchase_units[0].payments.captures[0].id;
    } else {
      orderId = resource.id || `unknown_${Date.now()}`;
    }

    // Determine status from event type
    const statusMap = {
      'PAYMENT.CAPTURE.COMPLETED': 'COMPLETED',
      'PAYMENT.CAPTURE.PENDING': 'PENDING', 
      'PAYMENT.CAPTURE.DENIED': 'DENIED',
      'CHECKOUT.ORDER.APPROVED': 'APPROVED',
      'CHECKOUT.ORDER.COMPLETED': 'COMPLETED'
    };

    const status = statusMap[eventType] || 'UNKNOWN';

    // Store order data
    orders.set(orderId, {
      id: orderId,
      status,
      eventType,
      amount: resource.amount,
      timestamp: webhookData.create_time,
      // Store additional useful data
      payer: resource.payer || webhookData.resource?.payer,
      items: resource.purchase_units?.[0]?.items,
      captureId: resource.id,
      orderId: resource.supplementary_data?.related_ids?.order_id
    });

    console.log(`✅ Updated order ${orderId}: ${status}`);
    console.log(`💰 Amount: ${resource.amount?.value} ${resource.amount?.currency_code}`);
    console.log(`📦 Capture ID: ${resource.id}`);
    console.log(`🛒 Order ID: ${resource.supplementary_data?.related_ids?.order_id}`);

    res.status(200).json({ 
      status: 'success', 
      orderId,
      eventType,
      processedStatus: status,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific order status
app.get('/api/orders/:orderId', (req, res) => {
  const orderId = req.params.orderId;
  const order = orders.get(orderId);
  
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  res.json(order);
});

// Get all orders (for admin)
app.get('/api/orders', (req, res) => {
  const allOrders = Array.from(orders.values());
  res.json(allOrders);
});

// Test endpoint to verify credentials are loaded
app.get('/api/verify-credentials', (req, res) => {
  res.json({
    sandbox: {
      clientId: sandboxClientId ? '✅ Loaded' : '❌ Missing',
      clientSecret: sandboxClientSecret ? '✅ Loaded' : '❌ Missing'
    },
    live: {
      clientId: liveClientId ? '✅ Loaded' : '❌ Missing',
      clientSecret: liveClientSecret ? '✅ Loaded' : '❌ Missing'
    }
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'King Solarman Backend',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    totalOrders: orders.size,
    version: '1.1.0',
    credentials: {
      sandboxLoaded: !!sandboxClientId,
      liveLoaded: !!liveClientId
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'King Solarman Backend API',
    environment: process.env.NODE_ENV || 'development',
    version: '1.1.0',
    endpoints: {
      webhook: 'POST /api/webhook/paypal',
      orderStatus: 'GET /api/orders/:orderId',
      allOrders: 'GET /api/orders',
      health: 'GET /api/health',
      verifyCredentials: 'GET /api/verify-credentials'
    },
    allowed_frontends: [
      'http://localhost:3000',
      'https://king-solarman-frontend.vercel.app',
      'https://kingsolarman.co.bw'
    ],
    webhook_urls: {
      sandbox: 'https://king-solarman-backend-railway.up.railway.app/api/webhook/paypal',
      live: 'https://king-solarman-backend-railway.up.railway.app/api/webhook/paypal'
    }
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const railwayUrl = 'https://king-solarman-backend-railway.up.railway.app';
  const localUrl = `http://localhost:${PORT}`;
  
  const backendUrl = isProduction ? railwayUrl : localUrl;
  const environment = isProduction ? 'PRODUCTION' : 'DEVELOPMENT';

  console.log(`╔══════════════════════════════════════╗`);
  console.log(`║   🚀 KING SOLARMAN BACKEND SERVER   ║`);
  console.log(`╚══════════════════════════════════════╝`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 Environment: ${environment}`);
  console.log(`🔗 Local URL: ${localUrl}`);
  console.log(`🌐 Railway URL: ${railwayUrl}`);
  console.log(``);
  console.log(`🔐 PayPal Credentials:`);
  console.log(`   Sandbox: ${sandboxClientId ? '✅ Loaded' : '❌ Missing'}`);
  console.log(`   Live:    ${liveClientId ? '✅ Loaded' : '❌ Missing'}`);
  console.log(``);
  console.log(`🔔 PayPal Webhook Endpoints:`);
  console.log(`   Sandbox: ${railwayUrl}/api/webhook/paypal`);
  console.log(`   Live:    ${railwayUrl}/api/webhook/paypal`);
  console.log(``);
  console.log(`📊 API Endpoints:`);
  console.log(`   Health: ${backendUrl}/api/health`);
  console.log(`   Orders: ${backendUrl}/api/orders/:orderId`);
  console.log(`   Verify: ${backendUrl}/api/verify-credentials`);
  console.log(``);
  console.log(`✅ Allowed Frontends:`);
  console.log(`   - http://localhost:3000`);
  console.log(`   - https://king-solarman-frontend.vercel.app`);
  console.log(`   - https://kingsolarman.co.bw`);
  console.log(`════════════════════════════════════════`);
});