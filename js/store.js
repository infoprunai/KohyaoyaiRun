/**
 * ========================================================
 * KOH YAO YAI RUN 2570 - DATA STORE & GOOGLE SHEETS ENGINE
 * กิจกรรมวิ่งเปิดโลกทะเล ประจำปี ๒๕๗๐ (อ่าวโล๊ะจาก เกาะยาวใหญ่)
 * ========================================================
 */

const KohYaoStore = (function () {
    'use strict';

    // Google Apps Script Web App URL (Production)
    const DEFAULT_GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw-l_3_ZohxfsLWOsGpdIoFxGKrI_gs31sOTnxZ3U5esODCW0NilX3K7vz70BAdIhlxaA/exec';
    let GOOGLE_SCRIPT_URL = localStorage.getItem('KOHYAO_GOOGLE_SCRIPT_URL') || DEFAULT_GOOGLE_SCRIPT_URL;

    const STORAGE_KEY = 'KOHYAO_RUN_2570_DB';
    let _cachedRegistrations = [];
    const CATEGORIES = {
        '5K': {
            name: 'ประเภทระยะทาง 5 KM.',
            distance: '5 กม.',
            price: 350,
            quota: 200,
            startTime: '05.30 น.',
            prefix: '5K-',
            color: '#06B6D4',
            accent: '#0E7490'
        },
        '10K': {
            name: 'ประเภทระยะทาง 10 KM.',
            distance: '10 กม.',
            price: 450,
            quota: 200,
            startTime: '06.00 น.',
            prefix: '10K-',
            color: '#F59E0B',
            accent: '#D97706'
        }
    };

    const LONG_SLEEVE_SURCHARGE = 50;

    const SHIRT_SIZES = [
        { size: 'XS', chest: 34, length: 25 },
        { size: 'S',  chest: 36, length: 26 },
        { size: 'M',  chest: 38, length: 27 },
        { size: 'L',  chest: 40, length: 28 },
        { size: 'XL', chest: 42, length: 29 },
        { size: '2XL', chest: 44, length: 30 },
        { size: '3XL', chest: 46, length: 31 }
    ];

    const STATUS = {
        PENDING: 'PENDING_PAYMENT',
        APPROVED: 'APPROVED',
        REJECTED: 'REJECTED'
    };

    function getInitialData() {
        return {
            registrations: [],
            sequences: { '5K': 0, '10K': 0 }
        };
    }

    function loadDB() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                const initial = getInitialData();
                saveDB(initial);
                return initial;
            }
            return JSON.parse(raw);
        } catch (e) {
            const initial = getInitialData();
            saveDB(initial);
            return initial;
        }
    }

    function saveDB(db) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
        } catch (e) {
            console.error('Storage quota error', e);
        }
    }

    function calculateAge(birthDateStr) {
        if (!birthDateStr) return { age: 0, group: 'ทั่วไป' };
        const birth = new Date(birthDateStr);
        const eventDate = new Date('2027-01-31');
        let age = eventDate.getFullYear() - birth.getFullYear();
        const m = eventDate.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && eventDate.getDate() < birth.getDate())) {
            age--;
        }

        let group = 'ทั่วไป';
        if (age < 20) group = 'ต่ำกว่า 20 ปี';
        else if (age <= 29) group = '20-29 ปี';
        else if (age <= 39) group = '30-39 ปี';
        else if (age <= 49) group = '40-49 ปี';
        else if (age <= 59) group = '50-59 ปี';
        else group = '60 ปีขึ้นไป';

        return { age, group };
    }

    function calculateFee(category, shirtType = 'แขนสั้น') {
        const categoryInfo = CATEGORIES[category] || CATEGORIES['5K'];
        const extra = (shirtType === 'แขนยาว') ? LONG_SLEEVE_SURCHARGE : 0;
        return categoryInfo.price + extra;
    }

    function computeHash(str) {
        let hash = 0;
        if (!str || str.length === 0) return 'empty';
        const sample = str.length > 2000 ? str.substring(500, 2500) : str;
        for (let i = 0; i < sample.length; i++) {
            const char = sample.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return 'hash_' + Math.abs(hash).toString(36) + '_' + str.length;
    }

    function compressSlipImage(file, maxWidth = 800, quality = 0.7) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type.match(/image.*/)) {
                return reject(new Error('กรุณาเลือกไฟล์รูปภาพที่ถูกต้อง'));
            }

            const originalSize = file.size;
            const reader = new FileReader();

            reader.onload = function (readerEvent) {
                const image = new Image();
                image.onload = function () {
                    const canvas = document.createElement('canvas');
                    let width = image.width;
                    let height = image.height;

                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, width, height);
                    ctx.drawImage(image, 0, 0, width, height);

                    const dataUrl = canvas.toDataURL('image/jpeg', quality);
                    const compressedSize = Math.round((dataUrl.length * 3) / 4);
                    const hash = computeHash(dataUrl);

                    resolve({
                        dataUrl: dataUrl,
                        originalSize: originalSize,
                        compressedSize: compressedSize,
                        savedPercent: Math.round((1 - (compressedSize / originalSize)) * 100),
                        width: width,
                        height: height,
                        hash: hash
                    });
                };
                image.onerror = () => reject(new Error('ไม่สามารถประมวลผลไฟล์รูปภาพได้'));
                image.src = readerEvent.target.result;
            };
            reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
            reader.readAsDataURL(file);
        });
    }

    async function callGoogleScript(action, payload = {}, method = 'POST') {
        if (!GOOGLE_SCRIPT_URL) return null;

        if (method === 'GET') {
            const url = new URL(GOOGLE_SCRIPT_URL);
            url.searchParams.append('action', action);
            for (let k in payload) {
                url.searchParams.append(k, payload[k]);
            }
            const res = await fetch(url.toString(), { method: 'GET', mode: 'cors' });
            return await res.json();
        } else {
            const body = { action: action, ...payload };
            const res = await fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(body)
            });
            return await res.json();
        }
    }

    return {
        CATEGORIES,
        LONG_SLEEVE_SURCHARGE,
        SHIRT_SIZES,
        STATUS,
        calculateAge,
        calculateFee,
        compressSlipImage,

        getGoogleScriptUrl() { return GOOGLE_SCRIPT_URL; },
        setGoogleScriptUrl(url) {
            GOOGLE_SCRIPT_URL = (url || '').trim() || DEFAULT_GOOGLE_SCRIPT_URL;
            localStorage.setItem('KOHYAO_GOOGLE_SCRIPT_URL', GOOGLE_SCRIPT_URL);
        },
        isGoogleSheetsActive() { return Boolean(GOOGLE_SCRIPT_URL); },

        // ตรวจสอบเลขบัตรประชาชนจาก Google Sheets จริง
        async findExistingByIdCard(idCard) {
            const cleanId = (idCard || '').trim();
            if (!cleanId) return null;

            if (GOOGLE_SCRIPT_URL) {
                try {
                    const res = await callGoogleScript('search', { keyword: cleanId }, 'GET');
                    if (res && res.success && Array.isArray(res.runners)) {
                        return res.runners.find(r => String(r.idCard).trim() === cleanId) || null;
                    }
                } catch (e) {
                    console.warn('Google Sheets ID check error:', e);
                }
                return null;
            }

            const db = loadDB();
            return db.registrations.find(r => r.idCard === cleanId) || null;
        },

        // ตรวจสอบสลิปซ้ำ (ทำงานร่วมกับทั้ง admin.html และ register.html)
        checkDuplicateSlip(slipHash, excludeRegId = null) {
            if (!slipHash) return null;

            if (GOOGLE_SCRIPT_URL) {
                return _cachedRegistrations.find(
                    r => r.slipHash === slipHash && r.id !== excludeRegId
                ) || null;
            }

            const db = loadDB();
            return db.registrations.find(
                r => r.slipHash === slipHash && r.id !== excludeRegId
            ) || null;
        },

        // 1. CREATE REGISTRATION
        async createRegistration(data) {
            const { age, group } = calculateAge(data.birthDate);
            const categoryInfo = CATEGORIES[data.category] || CATEGORIES['5K'];
            const shirtType = data.shirtType || 'แขนสั้น';
            const totalAmount = Number(data.amount) || calculateFee(data.category, shirtType);

            if (GOOGLE_SCRIPT_URL) {
                const res = await callGoogleScript('register', {
                    category: data.category,
                    firstName: data.firstName.trim(),
                    lastName: data.lastName.trim(),
                    idCard: data.idCard.trim(),
                    gender: data.gender,
                    birthDate: data.birthDate,
                    age: age,
                    ageGroup: group,
                    shirtSize: data.shirtSize,
                    shirtType: shirtType,
                    phone: data.phone.trim(),
                    email: (data.email || '').trim(),
                    bloodType: data.bloodType || 'ไม่ระบุ',
                    emergencyContact: data.emergencyContact.trim(),
                    emergencyPhone: data.emergencyPhone.trim(),
                    medicalConditions: (data.medicalConditions || '').trim() || 'ไม่มี',
                    base64Slip: data.slipUrl,
                    slipHash: data.slipHash,
                    amount: totalAmount
                }, 'POST');

                if (res && res.success) {
                    return res.data;
                } else {
                    throw new Error((res && res.message) || 'บันทึกข้อมูลลง Google Sheets ไม่สำเร็จ');
                }
            }

            // Local Fallback (กรณีไม่ได้ตั้งค่า URL)
            const db = loadDB();
            const cleanIdCard = (data.idCard || '').trim();
            const existing = db.registrations.find(r => r.idCard === cleanIdCard);
            if (existing) {
                throw new Error(`เลขบัตรประชาชน ${cleanIdCard} มีการลงทะเบียนในระบบแล้ว`);
            }

            const regId = `KYR-2570-${String(db.registrations.length + 1).padStart(3, '0')}`;
            const newReg = {
                id: regId,
                category: data.category,
                bibNumber: null,
                status: STATUS.PENDING,
                firstName: data.firstName.trim(),
                lastName: data.lastName.trim(),
                idCard: cleanIdCard,
                phone: (data.phone || '').trim(),
                email: (data.email || '').trim(),
                gender: data.gender,
                birthDate: data.birthDate,
                age: age,
                ageGroup: group,
                shirtSize: data.shirtSize,
                shirtType: shirtType,
                bloodType: data.bloodType || 'ไม่ระบุ',
                emergencyContact: (data.emergencyContact || '').trim(),
                emergencyPhone: (data.emergencyPhone || '').trim(),
                medicalConditions: (data.medicalConditions || '').trim() || 'ไม่มี',
                slipUrl: data.slipUrl || '',
                slipHash: data.slipHash || '',
                amount: totalAmount,
                createdAt: new Date().toISOString(),
                approvedAt: null,
                adminNotes: ''
            };

            db.registrations.unshift(newReg);
            saveDB(db);
            return newReg;
        },

        // 2. APPROVE SLIP & ISSUE BIB
        async approveRegistration(regId, adminNotes = '') {
            if (GOOGLE_SCRIPT_URL) {
                const res = await callGoogleScript('approve', { id: regId, adminNotes }, 'POST');
                if (res && res.success) return res.data || res;
                throw new Error((res && res.message) || 'อนุมัติไม่สำเร็จ');
            }

            const db = loadDB();
            const reg = db.registrations.find(r => r.id === regId);
            if (!reg) throw new Error('ไม่พบข้อมูลการลงทะเบียน');
            if (reg.status === STATUS.APPROVED && reg.bibNumber) return reg;

            const cat = reg.category;
            const currentSeq = db.sequences[cat] || 0;
            const nextSeq = currentSeq + 1;
            db.sequences[cat] = nextSeq;

            const prefix = CATEGORIES[cat].prefix;
            const bibNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;

            reg.status = STATUS.APPROVED;
            reg.bibNumber = bibNumber;
            reg.approvedAt = new Date().toISOString();
            reg.adminNotes = adminNotes || 'ตรวจสอบยอดเงินและสลิปเรียบร้อย';

            saveDB(db);
            return reg;
        },

        // 3. REJECT SLIP
        async rejectRegistration(regId, reason) {
            if (GOOGLE_SCRIPT_URL) {
                const res = await callGoogleScript('reject', { id: regId, reason }, 'POST');
                if (res && res.success) return res;
                throw new Error((res && res.message) || 'ปฏิเสธไม่สำเร็จ');
            }

            const db = loadDB();
            const reg = db.registrations.find(r => r.id === regId);
            if (!reg) throw new Error('ไม่พบข้อมูลการลงทะเบียน');

            reg.status = STATUS.REJECTED;
            reg.bibNumber = null;
            reg.adminNotes = reason || 'สลิปไม่ถูกต้อง หรือยอดเงินไม่ตรง';
            reg.approvedAt = null;

            saveDB(db);
            return reg;
        },

        // 4. RESUBMIT SLIP
        async resubmitSlip(regId, newSlipUrl, newSlipHash) {
            if (GOOGLE_SCRIPT_URL) {
                const res = await callGoogleScript('resubmitSlip', {
                    id: regId,
                    base64Slip: newSlipUrl,
                    slipHash: newSlipHash
                }, 'POST');
                if (res && res.success) return res;
                throw new Error((res && res.message) || 'ส่งสลิปใหม่ไม่สำเร็จ');
            }

            const db = loadDB();
            const reg = db.registrations.find(r => r.id === regId);
            if (!reg) throw new Error('ไม่พบข้อมูลการลงทะเบียน');

            reg.slipUrl = newSlipUrl;
            reg.slipHash = newSlipHash;
            reg.status = STATUS.PENDING;
            reg.adminNotes = 'อัปโหลดสลิปใหม่ รอเจ้าหน้าที่ตรวจสอบ';
            reg.updatedAt = new Date().toISOString();

            saveDB(db);
            return reg;
        },

        // 5. UPDATE RUNNER PROFILE
        async updateRunnerProfile(regId, updates) {
            if (GOOGLE_SCRIPT_URL) {
                const res = await callGoogleScript('updateProfile', { id: regId, updates }, 'POST');
                if (res && res.success) return res;
            }

            const db = loadDB();
            const reg = db.registrations.find(r => r.id === regId);
            if (!reg) throw new Error('ไม่พบข้อมูลการลงทะเบียน');

            if (updates.shirtSize) reg.shirtSize = updates.shirtSize;
            if (updates.shirtType) reg.shirtType = updates.shirtType;
            if (updates.amount !== undefined) reg.amount = Number(updates.amount);
            if (updates.phone) reg.phone = updates.phone.trim();
            if (updates.email !== undefined) reg.email = updates.email.trim();
            if (updates.emergencyContact) reg.emergencyContact = updates.emergencyContact.trim();
            if (updates.emergencyPhone) reg.emergencyPhone = updates.emergencyPhone.trim();
            if (updates.bloodType) reg.bloodType = updates.bloodType;
            if (updates.medicalConditions !== undefined) reg.medicalConditions = updates.medicalConditions.trim();

            reg.updatedAt = new Date().toISOString();
            saveDB(db);
            return reg;
        },

        // 6. SEARCH RUNNER
        async searchRunner(keyword) {
            const clean = (keyword || '').trim().toLowerCase();
            if (!clean) return [];

            if (GOOGLE_SCRIPT_URL) {
                const res = await callGoogleScript('search', { keyword: clean }, 'GET');
                if (res && res.success && res.runners) {
                    return res.runners;
                }
                return [];
            }

            const db = loadDB();
            return db.registrations.filter(r => 
                (r.idCard && r.idCard.includes(clean)) ||
                (r.phone && r.phone.includes(clean)) ||
                (r.id && r.id.toLowerCase().includes(clean)) ||
                (r.bibNumber && r.bibNumber.toLowerCase().includes(clean)) ||
                (`${r.firstName} ${r.lastName}`.toLowerCase().includes(clean))
            );
        },

        // 7. GET ALL REGISTRATIONS
        async getAllRegistrations() {
            if (GOOGLE_SCRIPT_URL) {
                const res = await callGoogleScript('getAll', {}, 'GET');
                if (res && res.success && res.runners) {
                    _cachedRegistrations = res.runners;
                    return res.runners;
                }
                return [];
            }
            const db = loadDB();
            return db.registrations;
        },

        // 8. GET SUMMARY STATS
        async getStats() {
            if (GOOGLE_SCRIPT_URL) {
                // อัปเดตแคชรายชื่อในพื้นหลังเพื่อให้หน้าสมัครเช็กสลิปซ้ำได้ทันที
                callGoogleScript('getAll', {}, 'GET').then(r => {
                    if (r && r.success && r.runners) _cachedRegistrations = r.runners;
                }).catch(() => {});

                const res = await callGoogleScript('getStats', {}, 'GET');
                if (res && res.success) {
                    return res;
                }
            }

            const db = loadDB();
            const regs = db.registrations;

            const total = regs.length;
            const approved = regs.filter(r => r.status === STATUS.APPROVED);
            const pending = regs.filter(r => r.status === STATUS.PENDING);
            const rejected = regs.filter(r => r.status === STATUS.REJECTED);

            const count5K = regs.filter(r => r.category === '5K' && r.status !== STATUS.REJECTED).length;
            const count10K = regs.filter(r => r.category === '10K' && r.status !== STATUS.REJECTED).length;

            const approved5K = approved.filter(r => r.category === '5K').length;
            const approved10K = approved.filter(r => r.category === '10K').length;

            const totalIncome = approved.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
            const pendingIncome = pending.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

            const shirtSizes = {};
            const shortSleeveSizes = {};
            const longSleeveSizes = {};

            SHIRT_SIZES.forEach(s => {
                shirtSizes[s.size] = 0;
                shortSleeveSizes[s.size] = 0;
                longSleeveSizes[s.size] = 0;
            });

            approved.forEach(r => {
                const sz = r.shirtSize || 'M';
                shirtSizes[sz] = (shirtSizes[sz] || 0) + 1;
                if (r.shirtType === 'แขนยาว') {
                    longSleeveSizes[sz] = (longSleeveSizes[sz] || 0) + 1;
                } else {
                    shortSleeveSizes[sz] = (shortSleeveSizes[sz] || 0) + 1;
                }
            });

            return {
                total,
                approvedCount: approved.length,
                pendingCount: pending.length,
                rejectedCount: rejected.length,
                count5K,
                count10K,
                approved5K,
                approved10K,
                remaining5K: Math.max(0, CATEGORIES['5K'].quota - count5K),
                remaining10K: Math.max(0, CATEGORIES['10K'].quota - count10K),
                totalIncome,
                pendingIncome,
                shirtSizes,
                shortSleeveSizes,
                longSleeveSizes
            };
        },

        // 9. EXPORT CSV
        async exportCSV(approvedOnly = true) {
            let list = await this.getAllRegistrations();
            if (approvedOnly) {
                list = list.filter(r => r.status === STATUS.APPROVED);
                list.sort((a, b) => (a.bibNumber || '').localeCompare(b.bibNumber || ''));
            }

            const headers = [
                'เลข BIB', 'รหัสการสมัคร', 'สถานะ', 'ระยะทาง', 'ชื่อ', 'นามสกุล',
                'เลขบัตร ปชช.', 'เบอร์โทร', 'อีเมล', 'เพศ', 'อายุ', 'กลุ่มอายุ',
                'ไซส์เสื้อ', 'รูปแบบเสื้อ', 'หมู่เลือด', 'โรคประจำตัว', 'ผู้ติดต่อฉุกเฉิน', 'เบอร์ฉุกเฉิน',
                'ยอดเงิน (บาท)', 'วันที่สมัคร', 'วันที่อนุมัติ'
            ];

            const rows = list.map(r => [
                r.bibNumber || 'รออนุมัติ',
                r.id,
                r.status,
                r.category,
                r.firstName,
                r.lastName,
                `'${r.idCard}`,
                `'${r.phone}`,
                r.email || '-',
                r.gender,
                r.age,
                r.ageGroup,
                r.shirtSize,
                r.shirtType || 'แขนสั้น',
                r.bloodType,
                `"${(r.medicalConditions || '-').replace(/"/g, '""')}"`,
                r.emergencyContact,
                `'${r.emergencyPhone}`,
                r.amount,
                r.createdAt ? r.createdAt.slice(0, 10) : '-',
                r.approvedAt ? r.approvedAt.slice(0, 10) : '-'
            ]);

            let csvContent = '\uFEFF' + headers.join(',') + '\n';
            rows.forEach(row => {
                csvContent += row.join(',') + '\n';
            });

            return csvContent;
        },

        resetDatabase() {
            localStorage.removeItem(STORAGE_KEY);
            return getInitialData();
        }
    };
})();

window.KohYaoStore = KohYaoStore;

/* ==========================================================================
   GLOBAL UI ENHANCEMENTS:
   1. STICKY TOPBAR AUTO-COMPACT & SCROLL PROGRESS BAR
   2. MOBILE BOTTOM QUICK-ACTION BAR (<= 768px)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Topbar Smart Compact & Progress Bar
    const siteNav = document.querySelector('.site-nav');
    if (siteNav) {
        const progressBar = document.createElement('div');
        progressBar.className = 'nav-scroll-progress';
        siteNav.appendChild(progressBar);

        const onScrollUpdateNav = () => {
            const scrollTop = window.scrollY || document.documentElement.scrollTop;

            if (scrollTop > 30) {
                siteNav.classList.add('scrolled');
            } else {
                siteNav.classList.remove('scrolled');
            }

            const docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
            const pct = docHeight > 0 ? Math.min(100, Math.max(0, (scrollTop / docHeight) * 100)) : 0;
            progressBar.style.width = pct + '%';
        };

        window.addEventListener('scroll', onScrollUpdateNav, { passive: true });
        onScrollUpdateNav();
    }

    // 2. Mobile Bottom Quick-Action Bar
    if (!document.querySelector('.mobile-bottom-bar')) {
        const currentPage = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
        const bottomBar = document.createElement('nav');
        bottomBar.className = 'mobile-bottom-bar';
        bottomBar.setAttribute('aria-label', 'เมนูลัดสำหรับมือถือ');

        if (currentPage === 'admin.html') {
            bottomBar.innerHTML = `
                <a href="#pendingQueueSection" class="mobile-quick-item">
                    คิวตรวจสลิป
                    <span class="quick-sub">รอตรวจสอบ</span>
                </a>
                <a href="#allRunners" class="mobile-quick-item">
                    รายชื่อทั้งหมด
                    <span class="quick-sub">ค้นหา & BIB</span>
                </a>
                <a href="index.html" class="mobile-quick-item quick-cta">
                    หน้าหลักเว็บ
                    <span class="quick-sub">มุมมองนักวิ่ง</span>
                </a>
            `;
        } else {
            const isHome = currentPage === 'index.html' || currentPage === '';
            const isStatus = currentPage === 'status.html';
            const isRegister = currentPage === 'register.html';

            bottomBar.innerHTML = `
                <a href="index.html" class="mobile-quick-item ${isHome ? 'active' : ''}">
                    หน้าแรก
                    <span class="quick-sub">ข้อมูล & เส้นทาง</span>
                </a>
                <a href="status.html" class="mobile-quick-item ${isStatus ? 'active' : ''}">
                    ตรวจ E-Bib
                    <span class="quick-sub">เช็กสถานะสลิป</span>
                </a>
                <a href="register.html" class="mobile-quick-item quick-cta ${isRegister ? 'active' : ''}">
                    สมัครแข่งขัน
                    <span class="quick-sub">ลงทะเบียนวิ่ง</span>
                </a>
            `;
        }

        document.body.appendChild(bottomBar);
    }
});