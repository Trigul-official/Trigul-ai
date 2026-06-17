const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Trigul AI...\n');

// Check if backend dependencies are installed
const backendPackagePath = path.join(__dirname, 'backend', 'package.json');
if (!fs.existsSync(backendPackagePath)) {
  console.log('❌ Backend package.json not found. Please run npm install in the backend folder first.');
  process.exit(1);
}

// Start backend
console.log('📡 Starting backend server...');
const backend = spawn('node', ['backend/server.js'], {
  stdio: 'inherit',
  shell: true
});

// Wait 3 seconds for backend to start
setTimeout(() => {
  console.log('📱 Starting frontend server...');
  
  // Check if http-server is installed globally
  const frontend = spawn('npx', ['http-server', 'frontend', '-p', '3000', '-o'], {
    stdio: 'inherit',
    shell: true
  });

  console.log('\n✅ Trigul AI is running!');
  console.log('📱 Frontend: http://localhost:3000');
  console.log('🔧 Backend: http://localhost:8000');
  console.log('\nPress Ctrl+C to stop both servers\n');

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down Trigul AI...');
    backend.kill();
    frontend.kill();
    process.exit();
  });
}, 3000);

// Handle errors
backend.on('error', (err) => {
  console.error('❌ Backend error:', err);
});

// Keep process alive
process.stdin.resume();
