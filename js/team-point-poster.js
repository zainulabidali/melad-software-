import { db, collection, getDocs, query, where, getDoc, doc } from './firebase.js';

let instId = localStorage.getItem('inst_id') || localStorage.getItem('user_inst_id');
let calculatedPointsMap = {};
let teamsMap = {};
let manualOverrides = {};
let currentBackground = 'default1';
let customBackgroundUrl = null;
let metadata = {};
let totalPublishedResults = 0;

document.addEventListener('DOMContentLoaded', async () => {
    if (!instId) {
        // Fallback for public viewing if passed via query param (if they use that mechanism)
        const urlParams = new URLSearchParams(window.location.search);
        instId = urlParams.get('id') || urlParams.get('instId');
    }

    if (!instId) {
        document.getElementById('posterMain').innerHTML = '<div class="loading-state">Error: Institute ID not found.</div>';
        return;
    }

    // Load local storage states
    loadLocalStates();
    setupControls();

    try {
        await fetchMetadataAndTeams();
        await fetchPublishedResultsAndCalculate();
        renderPoster();
    } catch (error) {
        console.error("Error loading poster data:", error);
        document.getElementById('posterMain').innerHTML = '<div class="loading-state">Error loading data.</div>';
    }
});

function loadLocalStates() {
    const savedOverrides = localStorage.getItem(`teamPointPoster_overrides_${instId}`);
    if (savedOverrides) {
        try {
            manualOverrides = JSON.parse(savedOverrides);
        } catch (e) { console.error(e); }
    }

    const savedBg = localStorage.getItem(`teamPointPoster_bg_${instId}`);
    if (savedBg) {
        currentBackground = savedBg;
    }

    const savedCustomBg = localStorage.getItem(`teamPointPoster_customBg_${instId}`);
    if (savedCustomBg) {
        customBackgroundUrl = savedCustomBg;
    }

    applyBackground();
}

async function fetchMetadataAndTeams() {
    // Fetch Metadata
    const metadataRef = doc(db, "institutes", instId, "metadata", "dashboard");
    const metaSnap = await getDoc(metadataRef);
    if (metaSnap.exists()) {
        metadata = metaSnap.data();
        
        document.getElementById('madrasaNameDisplay').textContent = metadata.madrasaName || 'Madrasa Name';
        document.getElementById('locationDisplay').textContent = metadata.madrasaLocation || '';
        
        if (metadata.eventName) {
            document.querySelector('.event-name').textContent = metadata.eventName;
        }
        if (metadata.eventTagline) {
            document.querySelector('.tagline').textContent = metadata.eventTagline;
        }

        const logoEl = document.getElementById('posterLogo');
        let logoSrc = metadata.madrasaLogo;

        try {
            const eventConfigRef = doc(db, "institutes", instId, "metadata", "eventConfig");
            const eventConfigSnap = await getDoc(eventConfigRef);
            if (eventConfigSnap.exists()) {
                const eventConfig = eventConfigSnap.data();
                if (eventConfig.eventLogo) {
                    logoSrc = eventConfig.eventLogo;
                }
                // Override text fields with eventConfig if present (matching public-results behavior)
                if (eventConfig.eventName) document.querySelector('.event-name').textContent = eventConfig.eventName;
                if (eventConfig.eventTagline) document.querySelector('.tagline').textContent = eventConfig.eventTagline;
                if (eventConfig.madrasaName) document.getElementById('madrasaNameDisplay').textContent = eventConfig.madrasaName;
            }
        } catch (e) {
            console.error("Error fetching eventConfig:", e);
        }

        if (logoSrc) {
            logoEl.src = logoSrc;
            logoEl.style.display = 'block';
        }
    }

    // Fetch Teams
    const teamsRef = collection(db, "institutes", instId, "teams");
    const teamsSnap = await getDocs(teamsRef);
    teamsSnap.forEach(doc => {
        const data = doc.data();
        if (data.name) {
            teamsMap[doc.id] = data.name;
        }
    });
}

async function fetchPublishedResultsAndCalculate() {
    const resultsRef = collection(db, "institutes", instId, "results");
    const publishedQuery = query(resultsRef, where("status", "==", "published"));
    const resultsSnap = await getDocs(publishedQuery);

    totalPublishedResults = resultsSnap.size;

    resultsSnap.forEach(doc => {
        const r = doc.data();
        
        // Use exactly the same data path as public results but ignore manual global points
        if (Array.isArray(r.marksData) && r.marksData.length > 0) {
            r.marksData.forEach(w => {
                if (w.teamId && w.teamId !== 'teamless' && w.totalPoints > 0) {
                    const pts = Number(w.totalPoints || 0);
                    calculatedPointsMap[w.teamId] = (calculatedPointsMap[w.teamId] || 0) + pts;
                }
            });
        } else if (Array.isArray(r.winners)) {
            r.winners.forEach(w => {
                if (w.teamId && w.teamId !== 'teamless' && w.marks > 0) {
                    const pts = Number(w.marks || 0);
                    calculatedPointsMap[w.teamId] = (calculatedPointsMap[w.teamId] || 0) + pts;
                }
            });
        }
    });
}

function renderPoster() {
    const mainContainer = document.getElementById('posterMain');
    const manualEditContainer = document.getElementById('manualEditContainer');
    mainContainer.innerHTML = '';
    manualEditContainer.innerHTML = '';

    // Add Result Count Display
    const resultCountEl = document.createElement('div');
    resultCountEl.className = 'result-count-display';
    resultCountEl.textContent = `After ${totalPublishedResults} Results`;
    mainContainer.appendChild(resultCountEl);

    // If no calculated points, but there are teams, initialize them with 0
    let displayTeams = [];
    
    // Gather all teams that have points or are in teamsMap
    const allTeamIds = new Set([...Object.keys(calculatedPointsMap), ...Object.keys(teamsMap)]);

    allTeamIds.forEach(teamId => {
        const teamName = teamsMap[teamId] || teamId;
        const actualPts = calculatedPointsMap[teamId] || 0;
        
        // Apply manual override if exists
        const finalPts = manualOverrides[teamId] !== undefined ? Number(manualOverrides[teamId]) : actualPts;
        
        displayTeams.push({
            id: teamId,
            name: teamName,
            actualPoints: actualPts,
            displayPoints: finalPts
        });
    });

    if (displayTeams.length === 0) {
        mainContainer.innerHTML = '<div class="loading-state">No teams or published results found.</div>';
        manualEditContainer.innerHTML = '<p style="font-size: 12px; color: #666;">No teams found.</p>';
        return;
    }

    // Sort by display points descending
    displayTeams.sort((a, b) => b.displayPoints - a.displayPoints);

    // Render Poster Cards
    displayTeams.forEach((team, index) => {
        const rank = index + 1;
        const card = document.createElement('div');
        card.className = 'team-points-card';
        card.setAttribute('data-rank', rank);
        
        card.innerHTML = `
            <div class="team-row">
                <span class="team-name">${team.name}</span>
                <span class="points-value">${team.displayPoints}</span>
            </div>
        `;
        mainContainer.appendChild(card);

        // Render Manual Controls
        const controlRow = document.createElement('div');
        controlRow.className = 'manual-team-row';
        controlRow.innerHTML = `
            <span>${team.name} (Auto: ${team.actualPoints})</span>
            <input type="number" id="manual_pt_${team.id}" value="${team.displayPoints}" />
        `;
        manualEditContainer.appendChild(controlRow);
    });
    
    // Expose array globally for the save button handler
    window.currentDisplayTeams = displayTeams;
}

function setupControls() {
    // Background picker logic
    const thumbs = document.querySelectorAll('.bg-thumb');
    
    // Init active class
    if (currentBackground && !currentBackground.startsWith('custom')) {
        const activeThumb = document.querySelector(`.bg-thumb[data-bg="${currentBackground}"]`);
        if (activeThumb) activeThumb.classList.add('active');
    }

    thumbs.forEach(thumb => {
        thumb.addEventListener('click', (e) => {
            thumbs.forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            
            const bgId = e.target.getAttribute('data-bg');
            currentBackground = bgId;
            localStorage.setItem(`teamPointPoster_bg_${instId}`, bgId);
            
            // If they pick a default, remove custom background usage for now
            applyBackground();
        });
    });

    // Custom background upload
    const customBgUpload = document.getElementById('customBgUpload');
    const clearCustomBgBtn = document.getElementById('clearCustomBgBtn');

    customBgUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const base64Str = event.target.result;
                customBackgroundUrl = base64Str;
                currentBackground = 'custom';
                
                try {
                    localStorage.setItem(`teamPointPoster_customBg_${instId}`, base64Str);
                    localStorage.setItem(`teamPointPoster_bg_${instId}`, 'custom');
                } catch (err) {
                    console.warn("Storage full or error saving custom background locally:", err);
                    alert("Could not save custom background permanently (file might be too large), but it will display for now.");
                }

                thumbs.forEach(t => t.classList.remove('active'));
                applyBackground();
            };
            reader.readAsDataURL(file);
        }
    });

    clearCustomBgBtn.addEventListener('click', () => {
        customBackgroundUrl = null;
        localStorage.removeItem(`teamPointPoster_customBg_${instId}`);
        currentBackground = 'default1';
        localStorage.setItem(`teamPointPoster_bg_${instId}`, 'default1');
        
        thumbs.forEach(t => t.classList.remove('active'));
        document.querySelector('.bg-thumb[data-bg="default1"]').classList.add('active');
        
        applyBackground();
    });

    // Save manual points
    document.getElementById('saveManualPointsBtn').addEventListener('click', () => {
        if (!window.currentDisplayTeams) return;
        
        let newOverrides = {};
        window.currentDisplayTeams.forEach(team => {
            const input = document.getElementById(`manual_pt_${team.id}`);
            if (input) {
                const val = parseFloat(input.value);
                if (!isNaN(val) && val !== team.actualPoints) {
                    newOverrides[team.id] = val;
                }
            }
        });
        
        manualOverrides = newOverrides;
        localStorage.setItem(`teamPointPoster_overrides_${instId}`, JSON.stringify(manualOverrides));
        
        alert("Points saved locally.");
        renderPoster();
    });

    // Download Image
    const downloadBtn = document.getElementById('downloadImageBtn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', async () => {
            const poster = document.getElementById('posterContainer');
            if (!poster) return;
            
            try {
                const originalText = downloadBtn.textContent;
                downloadBtn.textContent = 'Generating...';
                downloadBtn.disabled = true;
                
                // Ensure images are fully loaded before rendering (html2canvas handles this mostly, but good practice)
                const canvas = await html2canvas(poster, {
                    scale: 2, // High quality
                    useCORS: true,
                    backgroundColor: null
                });
                
                const link = document.createElement('a');
                link.download = 'Team_Points_Poster.png';
                link.href = canvas.toDataURL('image/png', 1.0);
                link.click();
                
                downloadBtn.textContent = originalText;
                downloadBtn.disabled = false;
            } catch (error) {
                console.error('Error generating image:', error);
                alert('Failed to generate image. Please try again.');
                downloadBtn.textContent = 'Download Image';
                downloadBtn.disabled = false;
            }
        });
    }
}

function applyBackground() {
    const poster = document.getElementById('posterContainer');
    const clearBtn = document.getElementById('clearCustomBgBtn');
    
    if (currentBackground === 'custom' && customBackgroundUrl) {
        poster.style.backgroundImage = `url('${customBackgroundUrl}')`;
        clearBtn.style.display = 'block';
    } else {
        clearBtn.style.display = 'none';
        poster.style.backgroundImage = 'none'; // reset
        
        // Define default backgrounds
        const backgrounds = {
            'default1': "url('../assets/tema-poster/team1.jfif')",
            'default2': "url('../assets/tema-poster/team2.jfif')",
            'default3': "url('../assets/tema-poster/team3.jfif')",
            'default4': "url('../assets/tema-poster/team4.jfif')"
        };
        
        poster.style.backgroundImage = backgrounds[currentBackground] || backgrounds['default1'];
        poster.style.backgroundSize = 'cover';
        poster.style.backgroundPosition = 'center';
    }
}
