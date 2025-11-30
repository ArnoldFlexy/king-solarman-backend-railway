const express = require('express');
const cors = require('cors');
const app = express();

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

// PayPal Webhook endpoint
app.post('/api/webhook/paypal', (req, res) => {
  try {
    const webhookData = req.body;
    console.log('🔔 PayPal Webhook:', webhookData.event_type);

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
      timestamp: webhookData.create_time
    });

    console.log(`✅ Updated order ${orderId}: ${status}`);

    res.status(200).json({ 
      status: 'success', 
      orderId,
      eventType 
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'King Solarman Backend',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'King Solarman Backend API',
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      webhook: 'POST /api/webhook/paypal',
      orderStatus: 'GET /api/orders/:orderId',
      allOrders: 'GET /api/orders',
      health: 'GET /api/health'
    },
    allowed_frontends: [
      'http://localhost:3000',
      'https://king-solarman-frontend.vercel.app',
      'https://kingsolarman.co.bw'
    ]
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const backendUrl = isProduction 
    ? 'https://your-railway-url.railway.app' 
    : `http://localhost:${PORT}`;
  
  console.log(`🚀 King Solarman Backend Server Started`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔔 PayPal Webhook URL: ${backendUrl}/api/webhook/paypal`);
  console.log(`❤️  Health Check: ${backendUrl}/api/health`);
  console.log(`📊 Order Status: ${backendUrl}/api/orders/:orderId`);
  console.log(`✅ Allowed Frontends:`);
  console.log(`   - http://localhost:3000`);
  console.log(`   - https://king-solarman-frontend.vercel.app`);
  console.log(`   - https://kingsolarman.co.bw`);
});