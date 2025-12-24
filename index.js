// app.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const fileRoutes = require('./routes/file-routes.js');

const app = express();


// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Platform-ID', 'X-API-Key']
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'multi-tenant-file-service'
  });
});

// API routes
app.use('/api/files', fileRoutes);


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`File service running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;