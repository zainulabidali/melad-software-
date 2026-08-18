const instId = 'OTm8dyIxxhQ78KzKSqzI';

async function run() {
    try {
        // Get all results
        const res = await globalThis.fetch(`https://firestore.googleapis.com/v1/projects/melad-software/databases/(default)/documents/institutes/${instId}/results`);
        const data = await res.json();
        
        const docs = data.documents || [];
        const results = docs.map(d => {
            const fields = d.fields;
            const id = d.name.split('/').pop();
            return {
                id,
                status: fields.status?.stringValue,
                publicReleased: fields.publicReleased?.booleanValue,
                publicDisabled: fields.publicDisabled?.booleanValue,
                programName: fields.programName?.stringValue,
                categoryName: fields.categoryName?.stringValue
            };
        });

        const publicResults = results.filter(r => r.status === 'published' && r.publicReleased === true);
        console.log("Admin Public Approved count:", publicResults.length);
        console.log(publicResults);
        
        // Let's also check what `public-results-hub.js` filters:
        // .filter(r => r.publicDisabled !== true)
        const hubResults = publicResults.filter(r => r.publicDisabled !== true);
        console.log("Hub Results count:", hubResults.length);
        console.log(hubResults);
        
    } catch (e) {
        console.error(e);
    }
}
run();
