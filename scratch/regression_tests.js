// regression_tests.js
console.log("=== REGRESSION TESTS ===");

const serverTimeMillis = Date.now();
const tenDays = 10 * 24 * 60 * 60 * 1000;
const expiryDate = serverTimeMillis + tenDays;

let mockDbStatus = "active";

// Old frontend logic (DANGEROUS)
function oldFrontendCheck(deviceTime) {
    const isExpired = deviceTime > expiryDate;
    if (isExpired) {
        mockDbStatus = "deactivated"; // It writes to DB!
    }
}

// New frontend logic (SAFE)
function newFrontendCheck(deviceTime) {
    const isExpired = deviceTime > expiryDate;
    if (isExpired) {
        // UI logic only (e.g. session clear)
        // No DB mutation!
    }
}

// Server logic
function serverCheck(serverTime) {
    if (serverTime > expiryDate) {
        mockDbStatus = "deactivated";
    }
}

function runTest(name, deviceTimeOffset, expectedStatus) {
    const deviceTime = serverTimeMillis + deviceTimeOffset;
    
    // Reset DB for test
    mockDbStatus = "active";
    
    // Run safe frontend logic
    newFrontendCheck(deviceTime);
    
    const result = mockDbStatus === expectedStatus ? "PASS" : "FAIL";
    console.log(`[${result}] ${name}`);
    console.log(`   Expected: ${expectedStatus} | Actual DB Status: ${mockDbStatus}`);
}

console.log("\n--- DEVICE CLOCK REGRESSION TESTS (Frontend) ---");
runTest("Test A: Correct device time, expiry future", 0, "active");
runTest("Test B: Device time +7 days, expiry +10 days", 7 * 24 * 60 * 60 * 1000, "active");
runTest("Test C: Device time +30 days, expiry +10 days (Frontend MUST NOT DEACTIVATE)", 30 * 24 * 60 * 60 * 1000, "active");
runTest("Test D: Device time -30 days", -30 * 24 * 60 * 60 * 1000, "active");

console.log("\n--- REAL SERVER EXPIRY TEST (Backend) ---");
mockDbStatus = "active";
console.log("Before actual expiry:");
serverCheck(serverTimeMillis);
console.log(`   Status: ${mockDbStatus} (Expected: active) - ${mockDbStatus === 'active' ? 'PASS' : 'FAIL'}`);

console.log("After actual server-side expiry (Time passes 11 days):");
serverCheck(serverTimeMillis + (11 * 24 * 60 * 60 * 1000));
console.log(`   Status: ${mockDbStatus} (Expected: deactivated) - ${mockDbStatus === 'deactivated' ? 'PASS' : 'FAIL'}`);
