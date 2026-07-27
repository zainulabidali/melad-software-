import re

with open('js/exports.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add helper functions before loadTeamBackgrounds
helper_code = """async function ensureEventDetailsLoaded(force = false) {
    if ((!window.currentEventDetails || force) && window.currentInstituteId) {
        try {
            const configSnap = await getDoc(doc(db, "institutes", window.currentInstituteId, "metadata", "eventConfig"));
            if (configSnap.exists()) {
                window.currentEventDetails = configSnap.data();
            }
        } catch (err) {
            console.error("Error loading eventConfig in exports:", err);
        }
    }
}

function getEventName() {
    const evName = window.currentEventDetails?.eventName?.trim();
    if (evName) return evName;
    const instName = window.currentInstituteDetails?.name?.trim();
    if (instName) return instName;
    return 'ADMIN PORTAL';
}

function loadTeamBackgrounds() {"""

if 'function loadTeamBackgrounds() {' in content:
    content = content.replace('function loadTeamBackgrounds() {', helper_code, 1)

# 2. Call ensureEventDetailsLoaded in loadStaticData
old_load_static = 'async function loadStaticData(force = false) {\n    try {\n        const instId = window.currentInstituteId;'
new_load_static = 'async function loadStaticData(force = false) {\n    try {\n        await ensureEventDetailsLoaded(force);\n        const instId = window.currentInstituteId;'
if old_load_static in content:
    content = content.replace(old_load_static, new_load_static, 1)

# 3. Call ensureEventDetailsLoaded in triggerDownload
old_trig_dl = 'async function triggerDownload(exp, isDownload = false) {\n    loadTeamBackgrounds();'
new_trig_dl = 'async function triggerDownload(exp, isDownload = false) {\n    loadTeamBackgrounds();\n    await ensureEventDetailsLoaded();'
if old_trig_dl in content:
    content = content.replace(old_trig_dl, new_trig_dl, 1)

# 4. Replace instName and eventName declarations
content = content.replace(
    "const eventName = eventDetails.eventName || window.currentInstituteDetails?.name || 'ADMIN PORTAL';",
    "const eventName = getEventName();"
)
content = content.replace(
    "const instName = window.currentInstituteDetails?.name || 'ADMIN PORTAL';",
    "const instName = getEventName();"
)

# 5. Program List sorting update (Stage first, then Off Stage)
old_prog_sort = """            // Sort programs inside each category by Program Number
            sortedCatNames.forEach(catName => {
                categoryGroups[catName].sort((a, b) => {
                    const numA = String(a.programNumber ?? '').trim();
                    const numB = String(b.programNumber ?? '').trim();
                    if (numA && numB) {
                        const cmp = numA.localeCompare(numB, undefined, { numeric: true, sensitivity: 'base' });
                        if (cmp !== 0) return cmp;
                    } else if (numA) {
                        return -1;
                    } else if (numB) {
                        return 1;
                    }
                    return (a.programName || '').localeCompare(b.programName || '');
                });
            });"""

new_prog_sort = """            // Sort programs inside each category: Stage programs first, then Off Stage programs (sorted using existing program order)
            sortedCatNames.forEach(catName => {
                categoryGroups[catName].sort((a, b) => {
                    const isStageA = (a.programLocation || a.location || 'Stage').toLowerCase() === 'stage' ? 0 : 1;
                    const isStageB = (b.programLocation || b.location || 'Stage').toLowerCase() === 'stage' ? 0 : 1;
                    if (isStageA !== isStageB) {
                        return isStageA - isStageB;
                    }

                    const numA = String(a.programNumber ?? '').trim();
                    const numB = String(b.programNumber ?? '').trim();
                    if (numA && numB) {
                        const cmp = numA.localeCompare(numB, undefined, { numeric: true, sensitivity: 'base' });
                        if (cmp !== 0) return cmp;
                    } else if (numA) {
                        return -1;
                    } else if (numB) {
                        return 1;
                    }
                    return (a.programName || '').localeCompare(b.programName || '');
                });
            });"""

if content.count(old_prog_sort) > 0:
    content = content.replace(old_prog_sort, new_prog_sort)

# 6. Update print iframe style blocks for URL print suppression (@page margin: 0 with body padding)
old_style_block_2 = """                    @page {
                        size: A4 ${orientation};
                        margin: ${pageMargin};
                    }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                        color: #000;
                        margin: 0;
                        padding: 0;
                        background: #fff;
                        font-size: 0.75rem;
                        line-height: 1.25;
                    }"""

new_style_block_2 = """                    @page {
                        size: A4 ${orientation};
                        margin: 0;
                    }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                        color: #000;
                        margin: 0;
                        padding: ${pageMargin};
                        box-sizing: border-box;
                        background: #fff;
                        font-size: 0.75rem;
                        line-height: 1.25;
                    }"""

if old_style_block_2 in content:
    content = content.replace(old_style_block_2, new_style_block_2, 1)

old_style_block_3 = """                    @page {
                        size: A4 ${orientation};
                        margin: ${pageMargin};
                    }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                        color: #000;
                        margin: 0;
                        padding: 0;
                        background: #fff;
                        font-size: 0.85rem;
                        line-height: 1.4;
                    }"""

new_style_block_3 = """                    @page {
                        size: A4 ${orientation};
                        margin: 0;
                    }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                        color: #000;
                        margin: 0;
                        padding: ${pageMargin};
                        box-sizing: border-box;
                        background: #fff;
                        font-size: 0.85rem;
                        line-height: 1.4;
                    }"""

if old_style_block_3 in content:
    content = content.replace(old_style_block_3, new_style_block_3, 1)

old_style_block_4 = """                @page {
                    size: A4 ${orientation};
                    margin: ${pageMargin};
                }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    color: #000;
                    margin: 0;
                    padding: 0;
                    background: #fff;
                    font-size: 0.85rem;
                    line-height: 1.4;
                }"""

new_style_block_4 = """                @page {
                    size: A4 ${orientation};
                    margin: 0;
                }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    color: #000;
                    margin: 0;
                    padding: ${pageMargin};
                    box-sizing: border-box;
                    background: #fff;
                    font-size: 0.85rem;
                    line-height: 1.4;
                }"""

if old_style_block_4 in content:
    content = content.replace(old_style_block_4, new_style_block_4, 1)

old_style_block_5 = """            @page {
                size: A4 ${orientation};
                margin: ${pageMargin}; /* Zero wasted spaces on valuation sheets */
            }
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                color: #000;
                margin: 0;
                padding: 0;
                background: #fff;
                font-size: ${f.type === 'Green Room Sign' ? '0.75rem' : '0.85rem'};
                line-height: ${f.type === 'Green Room Sign' ? '1.25' : '1.4'};
            }"""

new_style_block_5 = """            @page {
                size: A4 ${orientation};
                margin: 0;
            }
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                color: #000;
                margin: 0;
                padding: ${pageMargin};
                box-sizing: border-box;
                background: #fff;
                font-size: ${f.type === 'Green Room Sign' ? '0.75rem' : '0.85rem'};
                line-height: ${f.type === 'Green Room Sign' ? '1.25' : '1.4'};
            }"""

if old_style_block_5 in content:
    content = content.replace(old_style_block_5, new_style_block_5, 1)

with open('js/exports.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Updates successfully applied to js/exports.js")
