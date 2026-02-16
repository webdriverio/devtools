/**
 * Quick validation script to test the plugin without running actual browser tests
 * This verifies the plugin can be loaded and instantiated correctly
 */

const path = require('path');

async function validate() {
  console.log('🔍 Validating Nightwatch DevTools Plugin...\n');
  
  try {
    // Check if dist exists
    const distPath = path.join(__dirname, '..', 'dist');
    require('fs').accessSync(distPath);
    console.log('✅ Plugin compiled (dist/ exists)');
    
    // Try to load the plugin
    const plugin = require(path.join(__dirname, '..', 'dist', 'index.js'));
    console.log('✅ Plugin module loaded');
    
    // Check if it exports a class
    if (typeof plugin.default === 'function') {
      console.log('✅ Plugin exports default class');
      
      // Try to instantiate it
      const instance = new plugin.default({ port: 3001 });
      console.log('✅ Plugin can be instantiated');
      
      // Check for required methods
      const requiredMethods = ['before', 'beforeSuite', 'beforeEach', 'afterEach', 'after'];
      const hasAllMethods = requiredMethods.every(method => typeof instance[method] === 'function');
      
      if (hasAllMethods) {
        console.log('✅ All required lifecycle methods present:', requiredMethods.join(', '));
      } else {
        console.log('❌ Missing some lifecycle methods');
        return false;
      }
      
      console.log('\n✨ Plugin validation successful!');
      console.log('\nNext steps:');
      console.log('1. Make sure Chrome/Chromium is installed');
      console.log('2. Run: pnpm rebuild chromedriver');
      console.log('3. Run: pnpm example');
      
      return true;
    } else {
      console.log('❌ Plugin does not export a class');
      return false;
    }
  } catch (error) {
    console.error('❌ Validation failed:', error.message);
    return false;
  }
}

validate().then(success => {
  process.exit(success ? 0 : 1);
});
