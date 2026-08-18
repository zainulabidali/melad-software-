const fs = require('fs');
let content = fs.readFileSync('js/judge-portal.js', 'utf8');

const regex = /async function saveMarks\(prog, participants, judgesList, judgeIdx, existingResDoc, isSubmit\) \{[\s\S]*$/;

const newCode = `async function saveMarks(prog, participants, judgesList, judgeIdx, existingResDoc, isSubmit) {
    const rows = document.querySelectorAll('.jp-score-row');
    const isGroup = prog.programType === 'group' || prog.registrationType === 'group' || prog.type === 'Group';

    try {
        activePointsConfig = await getCachedPointsConfig(currentInstituteId, true);
    } catch (e) {
        console.error("Failed refreshing points config in saveMarks:", e);
    }

    const draftBtn = document.getElementById('jpDraftBtn');
    const submitBtn = document.getElementById('jpSubmitBtn');
    if (draftBtn) draftBtn.disabled = true;
    if (submitBtn) submitBtn.disabled = true;

    try {
        const docRef = doc(db, "institutes", currentInstituteId, "results", \`result_\${prog.id}\`);

        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(docRef);
            let latestResDoc = docSnap.exists() ? docSnap.data() : existingResDoc;

            const dbJudges = latestResDoc && Array.isArray(latestResDoc.judges) ? latestResDoc.judges : judgesList;
            const dbJudgeIds = latestResDoc && Array.isArray(latestResDoc.judgeIds) ? latestResDoc.judgeIds : [];
            let dbJudgeSubmissionStatus = latestResDoc && latestResDoc.judgeSubmissionStatus ? { ...latestResDoc.judgeSubmissionStatus } : {};

            const currentJudgeId = sessionStorage.getItem('standaloneJudgeId') || '';
            if (currentJudgeId) {
                dbJudgeSubmissionStatus[currentJudgeId] = isSubmit ? 'submitted' : 'saved';
            }

            const latestMarksMap = new Map();
            if (latestResDoc && Array.isArray(latestResDoc.marksData)) {
                latestResDoc.marksData.forEach(m => {
                    const key = m.studentId || m.groupId || '';
                    if (key) latestMarksMap.set(key, m);
                });
            }

            const updatedMarksData = [];

            rows.forEach(row => {
                const id = row.getAttribute('data-id');
                const name = row.getAttribute('data-name');
                const teamId = row.getAttribute('data-team-id');
                const teamName = row.getAttribute('data-team-name');
                const input = row.querySelector('.jp-mark-input');
                const codeLetter = input.getAttribute('data-code') || '';
                const val = input.value.trim();

                const existing = latestMarksMap.get(id) || {};
                const marks = Array.isArray(existing.marks) ? [...existing.marks] : [];

                while (marks.length < dbJudges.length) {
                    marks.push(null);
                }

                if (val !== '') {
                    marks[judgeIdx] = parseFloat(val);
                } else {
                    marks[judgeIdx] = null;
                }

                const manualGrades = existing.manualGrades && Array.isArray(existing.manualGrades) ? [...existing.manualGrades] : [];
                while (manualGrades.length < dbJudges.length) {
                    manualGrades.push(null);
                }
                const adminManualGrade = existing.adminManualGrade || null;
                const legacyManualGrade = existing.manualGrade || null;

                updatedMarksData.push({
                    studentId: isGroup ? '' : id,
                    groupId: isGroup ? id : '',
                    studentName: name || '',
                    teamId: teamId || '',
                    teamName: teamName || '',
                    codeLetter: codeLetter || existing.codeLetter || '',
                    marks,
                    adminManualGrade,
                    manualGrade: legacyManualGrade,
                    manualGrades
                });
            });

            const pType = (prog.programType || prog.type || 'individual').toLowerCase();
            let classType = 'individual';
            if (pType === 'general') classType = 'general';
            else if (pType === 'group') classType = 'group';

            const gradeModeSelect = document.getElementById('jpGradeModeSelect');
            const gradeMode = gradeModeSelect ? gradeModeSelect.value : (latestResDoc?.gradeMode || 'auto');

            const { marksData: finalMarksData, winners, allSubmitted } = calculateResultData({
                marksData: updatedMarksData,
                dbJudges: dbJudges,
                judgeIds: dbJudgeIds,
                judgeSubmissionStatus: dbJudgeSubmissionStatus,
                gradeMode: gradeMode,
                pointsConfig: activePointsConfig,
                classType: classType,
                isGroup: isGroup
            });

            const payload = {
                programId: prog.id,
                programName: prog.programName || prog.name || '',
                programType: prog.programType || prog.type || 'individual',
                registrationType: prog.registrationType || '',
                categoryId: prog.categoryId || '',
                categoryName: prog.categoryName || '',
                classId: prog.classId || '',
                className: prog.className || '',
                genderCategory: prog.genderCategory || '',
                programLocation: prog.programLocation || '',
                participantCount: participants.length,
                judges: dbJudges,
                judgeIds: dbJudgeIds,
                judgeSubmissionStatus: dbJudgeSubmissionStatus,
                marksData: finalMarksData,
                winners,
                status: latestResDoc?.status || 'draft',
                markEntryStatus: allSubmitted ? 'submitted' : 'in-progress',
                gradeMode,
                updatedAt: serverTimestamp()
            };

            if (latestResDoc && latestResDoc.publishedAt) payload.publishedAt = latestResDoc.publishedAt;
            if (latestResDoc && latestResDoc.status === 'published') payload.status = 'published';

            if (!docSnap.exists() && (!latestResDoc || !latestResDoc.createdAt)) {
                payload.createdAt = serverTimestamp();
            }

            transaction.set(docRef, payload, { merge: true });
        });

        window.showToast(isSubmit ? "📤 Marks submitted successfully!" : "📝 Draft saved successfully!", "success");
        setTimeout(() => loadAssignedPrograms(), 600);

    } catch (err) {
        console.error("Failed to save judge scores:", err);
        window.showToast("Failed to save marks.", "error");
    } finally {
        if (draftBtn) draftBtn.disabled = false;
        if (submitBtn) submitBtn.disabled = false;
    }
}
`;

content = content.replace(regex, newCode);
fs.writeFileSync('js/judge-portal.js', content);
