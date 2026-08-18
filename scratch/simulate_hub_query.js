const instId = 'OTm8dyIxxhQ78KzKSqzI';

async function run() {
    try {
        const payload = {
            structuredQuery: {
                from: [{ collectionId: "results" }],
                where: {
                    compositeFilter: {
                        op: "AND",
                        filters: [
                            {
                                fieldFilter: {
                                    field: { fieldPath: "status" },
                                    op: "EQUAL",
                                    value: { stringValue: "published" }
                                }
                            },
                            {
                                fieldFilter: {
                                    field: { fieldPath: "publicReleased" },
                                    op: "EQUAL",
                                    value: { booleanValue: true }
                                }
                            }
                        ]
                    }
                }
            }
        };
        
        const res = await globalThis.fetch(`https://firestore.googleapis.com/v1/projects/melad-software/databases/(default)/documents/institutes/${instId}:runQuery`, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await res.json();
        
        const results = data.filter(d => d.document).map(d => {
            const fields = d.document.fields;
            const id = d.document.name.split('/').pop();
            return {
                id,
                programName: fields.programName?.stringValue,
                publicDisabled: fields.publicDisabled?.booleanValue,
            };
        });

        console.log("Hub Query Results count:", results.length);
        console.log(results);
        
    } catch (e) {
        console.error(e);
    }
}
run();
