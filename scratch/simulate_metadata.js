const instId = 'OTm8dyIxxhQ78KzKSqzI';

async function run() {
    try {
        const res = await globalThis.fetch(`https://firestore.googleapis.com/v1/projects/melad-software/databases/(default)/documents/institutes/${instId}/results?pageSize=1000`);
        const data = await res.json();
        
        const docs = data.documents || [];
        const results = docs.map(d => {
            const fields = d.fields;
            const id = d.name.split('/').pop();
            
            // Replicate exactly what firebase.js does when mapping:
            // ({ id: d.id, ...d.data() })
            // We'll just extract the exact values
            return {
                id,
                status: fields.status?.stringValue,
                publicReleased: fields.publicReleased?.booleanValue
            };
        });

        const publicPublishedCount = results.filter(r => r.status === 'published' && r.publicReleased === true).length;
        console.log("updateDashboardMetadata computes:", publicPublishedCount);
        
        const publicResults = results.filter(r => r.status === 'published' && r.publicReleased === true);
        console.log(publicResults);
        
    } catch (e) {
        console.error(e);
    }
}
run();
