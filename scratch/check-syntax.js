const fs = require('fs');

const files = [
    'js/firebase.js',
    'js/settings.js',
    'js/mark-entry.js',
    'js/judge-portal.js',
    'js/results.js',
    'js/exports.js'
];

files.forEach(file => {
    try {
        let code = fs.readFileSync(file, 'utf8');
        code = code.replace(/^import\s+[\s\S]*?;/gm, '');
        code = code.replace(/export\s+async\s+function/g, 'async function');
        code = code.replace(/export\s+function/g, 'function');
        code = code.replace(/export\s+const/g, 'const');
        code = code.replace(/export\s+let/g, 'let');
        code = code.replace(/export\s+default/g, '');
        
        new Function(code);
        console.log(`[SUCCESS] ${file} valid JS syntax.`);
    } catch (e) {
        console.error(`[ERROR] ${file}:`, e.message);
    }
});
