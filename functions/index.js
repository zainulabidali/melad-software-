const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.adminResetPassword = functions.https.onCall(async (data, context) => {
    // 1. Verify caller is authenticated
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const callerUid = context.auth.uid;
    const targetEmail = data.targetEmail;
    const newPassword = data.newPassword;

    if (!targetEmail || !newPassword) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required parameters.');
    }

    try {
        // 2. Verify caller is Super Admin
        const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
        if (!callerDoc.exists || callerDoc.data().role !== 'super_admin') {
            throw new functions.https.HttpsError('permission-denied', 'Only Super Admins can reset passwords.');
        }

        const callerEmail = context.auth.token.email || callerDoc.data().email || 'Unknown';

        // 3. Verify target user exists in Auth
        let targetUserRecord;
        try {
            targetUserRecord = await admin.auth().getUserByEmail(targetEmail);
        } catch (e) {
            throw new functions.https.HttpsError('not-found', 'Target user does not exist in Authentication.');
        }

        const targetUid = targetUserRecord.uid;

        // 4. Verify target account belongs to a valid institute
        const institutesSnapshot = await admin.firestore().collection('institutes')
            .where('teacherEmail', '==', targetEmail)
            .limit(1)
            .get();

        let instituteId = 'Unknown';
        if (!institutesSnapshot.empty) {
            const instDoc = institutesSnapshot.docs[0];
            instituteId = instDoc.id;
            const instData = instDoc.data();
            
            // Verify institute is active
            if (instData.status !== 'active') {
                throw new functions.https.HttpsError('failed-precondition', 'Target institute is not active.');
            }
        } else {
            throw new functions.https.HttpsError('failed-precondition', 'Target user does not belong to a valid institute.');
        }

        // 5. Perform the password reset
        await admin.auth().updateUser(targetUid, {
            password: newPassword
        });

        // 6. Create Audit Log (Success)
        await admin.firestore().collection('audit_logs').add({
            action: 'PASSWORD_RESET',
            resetTime: admin.firestore.FieldValue.serverTimestamp(),
            superAdminUid: callerUid,
            superAdminEmail: callerEmail,
            targetUserUid: targetUid,
            targetEmail: targetEmail,
            instituteId: instituteId,
            status: 'Success'
        });

        return { success: true, message: 'Password updated successfully.' };

    } catch (error) {
        // Log failure if it's a known error and we have enough info
        if (error instanceof functions.https.HttpsError && error.code !== 'unauthenticated') {
             try {
                 await admin.firestore().collection('audit_logs').add({
                    action: 'PASSWORD_RESET',
                    resetTime: admin.firestore.FieldValue.serverTimestamp(),
                    superAdminUid: context.auth.uid,
                    superAdminEmail: context.auth.token?.email || 'Unknown',
                    targetUserUid: targetUid,
                    targetEmail: 'Unknown',
                    instituteId: 'Unknown',
                    status: 'Failed',
                    error: error.message
                });
             } catch (logError) {
                 console.error("Failed to write audit log:", logError);
             }
        }
        
        console.error("Password reset error:", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'An internal error occurred during password reset.');
    }
});
