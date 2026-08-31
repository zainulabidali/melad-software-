/**
 * Certificate Generator Controller
 * Modern Blue Wave & Rosette Badge Edition
 * Madrasa & Meelad Management Software
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements - Certificate Dynamic Fields
    const certSheet = document.getElementById('certSheet');
    const certMadrasaName = document.getElementById('dispMadrasaName');
    const certInstitutionSub = document.getElementById('dispInstitutionSub');
    const certLogoImg = document.getElementById('dispLogoImg');
    const certLogoPlaceholder = document.getElementById('dispLogoPlaceholder');
    const certStudentName = document.getElementById('dispStudentName');
    const certPositionText = document.getElementById('dispPositionText');
    const certProgramName = document.getElementById('dispProgramName');
    const certEventName = document.getElementById('dispEventName');
    const certDate = document.getElementById('dispDate');
    const certAcademicYear = document.getElementById('dispAcademicYear');
    const certNumber = document.getElementById('dispCertNumber');
    
    const certBadgeTop = document.getElementById('dispBadgeTop');
    const certBadgeBottom = document.getElementById('dispBadgeBottom');
    
    const certSign1Title = document.getElementById('dispSign1Title');
    const certSign1Img = document.getElementById('dispSign1Img');
    const certSignPlaceholder = document.getElementById('dispSignPlaceholder');

    // DOM Elements - Input Controls
    const selectCatTheme = document.getElementById('selectCatTheme');
    const selectPosition = document.getElementById('selectPosition');
    const inputMadrasaName = document.getElementById('inputMadrasaName');
    const inputInstitutionSub = document.getElementById('inputInstitutionSub');
    const inputStudentName = document.getElementById('inputStudentName');
    const inputProgramName = document.getElementById('inputProgramName');
    const inputEventName = document.getElementById('inputEventName');
    const inputDate = document.getElementById('inputDate');
    const inputAcademicYear = document.getElementById('inputAcademicYear');
    const inputCertNumber = document.getElementById('inputCertNumber');
    
    const inputSign1Name = document.getElementById('inputSign1Name');
    const inputSign1Title = document.getElementById('inputSign1Title');
    
    const logoUpload = document.getElementById('logoUpload');
    const sign1Upload = document.getElementById('sign1Upload');

    // Buttons
    const btnPrint = document.getElementById('btnPrintCert');
    const btnDownloadImg = document.getElementById('btnDownloadImg');
    const btnDownloadSvg = document.getElementById('btnDownloadSvg');
    const btnLoadSample = document.getElementById('btnLoadSample');
    const btnStressTest = document.getElementById('btnStressTest');
    const btnReset = document.getElementById('btnReset');

    // Auto-Scaler Function for Long Names
    function adjustStudentNameScale(text) {
        if (!certStudentName) return;
        const len = text.length;
        if (len > 40) {
            certStudentName.style.fontSize = '6.8mm';
            certStudentName.style.letterSpacing = '-0.01em';
        } else if (len > 30) {
            certStudentName.style.fontSize = '8.2mm';
            certStudentName.style.letterSpacing = '-0.01em';
        } else if (len > 22) {
            certStudentName.style.fontSize = '9.5mm';
            certStudentName.style.letterSpacing = '-0.02em';
        } else {
            certStudentName.style.fontSize = '11mm';
            certStudentName.style.letterSpacing = '-0.01em';
        }
    }

    function adjustMadrasaNameScale(text) {
        if (!certMadrasaName) return;
        const len = text.length;
        if (len > 45) {
            certMadrasaName.style.fontSize = '3.8mm';
        } else if (len > 32) {
            certMadrasaName.style.fontSize = '4.2mm';
        } else {
            certMadrasaName.style.fontSize = '4.6mm';
        }
    }

    // Theme Switcher Handler
    function updateTheme(themeClass) {
        if (!certSheet) return;
        const themeClasses = Array.from(certSheet.classList).filter(c => c.startsWith('cat-theme-'));
        themeClasses.forEach(c => certSheet.classList.remove(c));
        certSheet.classList.add(themeClass || 'cat-theme-general');
    }

    // Position State Handler
    function updatePosition(position) {
        if (!certSheet || !certPositionText) return;
        
        certSheet.classList.remove('pos-first', 'pos-second', 'pos-third');
        
        if (position === 'FIRST') {
            certSheet.classList.add('pos-first');
            certPositionText.textContent = 'FIRST POSITION';
            if (certBadgeTop) certBadgeTop.textContent = 'BEST';
            if (certBadgeBottom) certBadgeBottom.textContent = 'AWARD';
        } else if (position === 'SECOND') {
            certSheet.classList.add('pos-second');
            certPositionText.textContent = 'SECOND POSITION';
            if (certBadgeTop) certBadgeTop.textContent = '2ND';
            if (certBadgeBottom) certBadgeBottom.textContent = 'AWARD';
        } else if (position === 'THIRD') {
            certSheet.classList.add('pos-third');
            certPositionText.textContent = 'THIRD POSITION';
            if (certBadgeTop) certBadgeTop.textContent = '3RD';
            if (certBadgeBottom) certBadgeBottom.textContent = 'AWARD';
        } else {
            certSheet.classList.add('pos-first');
            certPositionText.textContent = position.toUpperCase();
            if (certBadgeTop) certBadgeTop.textContent = 'MERIT';
            if (certBadgeBottom) certBadgeBottom.textContent = 'AWARD';
        }
    }

    // Bind Event Listeners for Live Updates
    if (selectCatTheme) {
        selectCatTheme.addEventListener('change', (e) => {
            updateTheme(e.target.value);
        });
    }

    if (inputMadrasaName) {
        inputMadrasaName.addEventListener('input', (e) => {
            const val = e.target.value.trim() || '[MADRASA / INSTITUTION NAME]';
            certMadrasaName.textContent = val;
            adjustMadrasaNameScale(val);
            localStorage.setItem('meelad_cert_madrasa_name', e.target.value.trim());
        });
    }

    if (inputInstitutionSub) {
        inputInstitutionSub.addEventListener('input', (e) => {
            const val = e.target.value.trim() || 'DEPARTMENT OF ISLAMIC EDUCATION & CULTURAL AFFAIRS';
            certInstitutionSub.textContent = val;
            localStorage.setItem('meelad_cert_institution_sub', e.target.value.trim());
        });
    }

    if (inputStudentName) {
        inputStudentName.addEventListener('input', (e) => {
            const val = e.target.value.trim() || '[STUDENT FULL NAME]';
            certStudentName.textContent = val;
            adjustStudentNameScale(val);
        });
    }

    if (selectPosition) {
        selectPosition.addEventListener('change', (e) => {
            updatePosition(e.target.value);
        });
    }

    if (inputProgramName) {
        inputProgramName.addEventListener('input', (e) => {
            certProgramName.textContent = e.target.value.trim() || '[PROGRAM / COMPETITION NAME]';
        });
    }

    if (inputEventName) {
        inputEventName.addEventListener('input', (e) => {
            certEventName.textContent = e.target.value.trim() || '[EVENT / MEELAD FESTIVAL NAME]';
        });
    }

    if (inputDate) {
        inputDate.addEventListener('input', (e) => {
            const val = e.target.value.trim() || 'JANUARY 2ND 2025';
            certDate.textContent = val;
            localStorage.setItem('meelad_cert_date', e.target.value.trim());
        });
    }

    if (inputAcademicYear) {
        inputAcademicYear.addEventListener('input', (e) => {
            certAcademicYear.textContent = e.target.value.trim() || '2026 – 2027';
        });
    }

    if (inputCertNumber) {
        inputCertNumber.addEventListener('input', (e) => {
            certNumber.textContent = e.target.value.trim() || 'MLS-2026-0000';
        });
    }

    if (inputSign1Title) {
        inputSign1Title.addEventListener('input', (e) => {
            const val = e.target.value.trim() || 'PRINCIPAL / GENERAL SECRETARY';
            certSign1Title.textContent = val;
            localStorage.setItem('meelad_cert_sign_title', e.target.value.trim());
        });
    }

    // Image Upload Handlers with localStorage caching
    function handleImageUpload(inputEl, imgEl, placeholderEl, storageKey) {
        if (!inputEl) return;
        inputEl.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const dataUrl = event.target.result;
                    imgEl.src = dataUrl;
                    imgEl.style.display = 'block';
                    if (placeholderEl) placeholderEl.style.display = 'none';
                    if (storageKey) localStorage.setItem(storageKey, dataUrl);
                };
                reader.readAsDataURL(file);
            }
        });
    }

    handleImageUpload(logoUpload, certLogoImg, certLogoPlaceholder, 'meelad_cert_logo');
    handleImageUpload(sign1Upload, certSign1Img, certSignPlaceholder, 'meelad_cert_sign_img');

    // Auto-load saved branding
    const savedMadrasa = localStorage.getItem('meelad_cert_madrasa_name');
    const savedSub = localStorage.getItem('meelad_cert_institution_sub');
    const savedLogo = localStorage.getItem('meelad_cert_logo');
    const savedSignTitle = localStorage.getItem('meelad_cert_sign_title');
    const savedSignImg = localStorage.getItem('meelad_cert_sign_img');
    const savedDate = localStorage.getItem('meelad_cert_date');

    if (savedMadrasa && inputMadrasaName) inputMadrasaName.value = savedMadrasa;
    if (savedSub && inputInstitutionSub) inputInstitutionSub.value = savedSub;
    if (savedSignTitle && inputSign1Title) inputSign1Title.value = savedSignTitle;
    if (savedDate && inputDate) inputDate.value = savedDate;

    if (savedLogo && certLogoImg) {
        certLogoImg.src = savedLogo;
        certLogoImg.style.display = 'block';
        if (certLogoPlaceholder) certLogoPlaceholder.style.display = 'none';
    }
    if (savedSignImg && certSign1Img) {
        certSign1Img.src = savedSignImg;
        certSign1Img.style.display = 'block';
        if (certSignPlaceholder) certSignPlaceholder.style.display = 'none';
    }

    // Trigger initial input sync
    if (inputMadrasaName) inputMadrasaName.dispatchEvent(new Event('input'));
    if (inputInstitutionSub) inputInstitutionSub.dispatchEvent(new Event('input'));
    if (inputSign1Title) inputSign1Title.dispatchEvent(new Event('input'));
    if (inputDate) inputDate.dispatchEvent(new Event('input'));

    // Preset Data Loaders
    if (btnLoadSample) {
        btnLoadSample.addEventListener('click', () => {
            if (selectCatTheme) selectCatTheme.value = 'cat-theme-general';
            inputMadrasaName.value = 'COMPANY NAME';
            inputInstitutionSub.value = 'DEPARTMENT OF ISLAMIC EDUCATION & CULTURAL AFFAIRS';
            inputStudentName.value = 'Name Surname';
            selectPosition.value = 'FIRST';
            inputProgramName.value = 'Senior Qira\'at & Tajweed Championship';
            inputEventName.value = 'Grand Meelad Fest 2026';
            inputDate.value = 'JANUARY 2ND 2025';
            inputAcademicYear.value = '2026 – 2027';
            inputCertNumber.value = 'MLS-2026-0842';
            inputSign1Title.value = 'SIGNATURE';

            // Trigger sync
            if (selectCatTheme) selectCatTheme.dispatchEvent(new Event('change'));
            inputMadrasaName.dispatchEvent(new Event('input'));
            inputInstitutionSub.dispatchEvent(new Event('input'));
            inputStudentName.dispatchEvent(new Event('input'));
            selectPosition.dispatchEvent(new Event('change'));
            inputProgramName.dispatchEvent(new Event('input'));
            inputEventName.dispatchEvent(new Event('input'));
            inputDate.dispatchEvent(new Event('input'));
            inputAcademicYear.dispatchEvent(new Event('input'));
            inputCertNumber.dispatchEvent(new Event('input'));
            inputSign1Title.dispatchEvent(new Event('input'));
        });
    }

    if (btnStressTest) {
        btnStressTest.addEventListener('click', () => {
            if (selectCatTheme) selectCatTheme.value = 'cat-theme-3';
            inputMadrasaName.value = 'Darul Huda Islamic University & Academy of Advanced Religious Sciences';
            inputInstitutionSub.value = 'DEPARTMENT OF HIGHER RESEARCH & INTER-MADRASA EXCELLENCE COUNCIL';
            inputStudentName.value = 'Sayyid Ahmed Munawwar Ali Shihab Thangal Al-Bukhari';
            selectPosition.value = 'SECOND';
            inputProgramName.value = 'Inter-State Classical Arabic Elocution & Debating Summit';
            inputEventName.value = 'Annual National Meelad Cultural Carnival 2026';
            inputDate.value = '24 OCTOBER 2026';
            inputAcademicYear.value = '2026 – 2027';
            inputCertNumber.value = 'MLS-2026-9912';
            inputSign1Title.value = 'CHANCELLOR & HEAD OF JURY';

            // Trigger sync
            if (selectCatTheme) selectCatTheme.dispatchEvent(new Event('change'));
            inputMadrasaName.dispatchEvent(new Event('input'));
            inputInstitutionSub.dispatchEvent(new Event('input'));
            inputStudentName.dispatchEvent(new Event('input'));
            selectPosition.dispatchEvent(new Event('change'));
            inputProgramName.dispatchEvent(new Event('input'));
            inputEventName.dispatchEvent(new Event('input'));
            inputDate.dispatchEvent(new Event('input'));
            inputAcademicYear.dispatchEvent(new Event('input'));
            inputCertNumber.dispatchEvent(new Event('input'));
            inputSign1Title.dispatchEvent(new Event('input'));
        });
    }

    if (btnReset) {
        btnReset.addEventListener('click', () => {
            if (selectCatTheme) selectCatTheme.value = 'cat-theme-general';
            inputMadrasaName.value = '';
            inputInstitutionSub.value = '';
            inputStudentName.value = '';
            selectPosition.value = 'FIRST';
            inputProgramName.value = '';
            inputEventName.value = '';
            inputDate.value = '';
            inputAcademicYear.value = '';
            inputCertNumber.value = '';
            inputSign1Title.value = '';

            certLogoImg.style.display = 'none';
            certLogoPlaceholder.style.display = 'flex';
            certSign1Img.style.display = 'none';
            if (certSignPlaceholder) certSignPlaceholder.style.display = 'block';

            if (selectCatTheme) selectCatTheme.dispatchEvent(new Event('change'));
            inputMadrasaName.dispatchEvent(new Event('input'));
            inputInstitutionSub.dispatchEvent(new Event('input'));
            inputStudentName.dispatchEvent(new Event('input'));
            selectPosition.dispatchEvent(new Event('change'));
            inputProgramName.dispatchEvent(new Event('input'));
            inputEventName.dispatchEvent(new Event('input'));
            inputDate.dispatchEvent(new Event('input'));
            inputAcademicYear.dispatchEvent(new Event('input'));
            inputCertNumber.dispatchEvent(new Event('input'));
            inputSign1Title.dispatchEvent(new Event('input'));
        });
    }

    // Print Handler
    if (btnPrint) {
        btnPrint.addEventListener('click', () => {
            window.print();
        });
    }

    // Download High-Res Image Handler
    if (btnDownloadImg) {
        btnDownloadImg.addEventListener('click', () => {
            if (typeof html2canvas === 'undefined') {
                alert('html2canvas library is loading, please try again in a moment or use the Print button to Save as PDF.');
                return;
            }
            
            btnDownloadImg.disabled = true;
            btnDownloadImg.textContent = 'Generating 300 DPI Image...';

            html2canvas(certSheet, {
                scale: 3,
                useCORS: true,
                backgroundColor: '#FFFFFF',
                logging: false
            }).then(canvas => {
                const link = document.createElement('a');
                const student = (inputStudentName.value || 'Student').replace(/\s+/g, '_');
                link.download = `Certificate_${student}_A4.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
                btnDownloadImg.disabled = false;
                btnDownloadImg.textContent = 'Download High-Res PNG';
            }).catch(err => {
                console.error('Error generating image:', err);
                alert('Failed to generate image. Please use Print -> Save as PDF.');
                btnDownloadImg.disabled = false;
                btnDownloadImg.textContent = 'Download High-Res PNG';
            });
        });
    }

    // Zoom Preview Handler
    const zoomWrap = document.getElementById('certZoomWrap');
    const zoomBtns = document.querySelectorAll('.zoom-btn');
    if (zoomBtns.length > 0 && zoomWrap) {
        zoomBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                zoomBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const scale = btn.getAttribute('data-scale') || '0.8';
                zoomWrap.style.transform = `scale(${scale})`;
            });
        });
    }

    // Initialize Default State
    updatePosition('FIRST');
    updateTheme('cat-theme-general');
});
