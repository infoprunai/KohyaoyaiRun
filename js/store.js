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
            startTime: '06.00 น.',
            prefix: '5K-',
            color: '#06B6D4',
            accent: '#0E7490'
        },
        '10K': {
            name: 'ประเภทระยะทาง 10 KM.',
            distance: '10 กม.',
            price: 450,
            quota: 200,
            startTime: '05.30 น.',
            prefix: '10K-',
            color: '#F59E0B',
            accent: '#D97706'
        }
    };

    const LONG_SLEEVE_SURCHARGE = 80;

    const SHIRT_SIZES = [
        { size: '2XS', chest: 34, length: 25 },
        { size: 'XS',  chest: 36, length: 26 },
        { size: 'S',   chest: 38, length: 27 },
        { size: 'M',   chest: 40, length: 28 },
        { size: 'L',   chest: 42, length: 29 },
        { size: 'XL',  chest: 44, length: 30 },
        { size: '2XL', chest: 46, length: 31 }
    ];

    const STATUS = {
        PENDING: 'PENDING_PAYMENT',
        APPROVED: 'APPROVED',
        REJECTED: 'REJECTED'
    };

    function getSiteBaseUrl() {
        try {
            if (window.location && window.location.origin && window.location.origin !== 'null') {
                const dirPath = window.location.pathname.replace(/\/[^/]*$/, '');
                return window.location.origin + dirPath;
            }
        } catch (e) {}
        return '';
    }

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
        if (!birthDateStr) return { age: 0 };
        const birth = new Date(birthDateStr);
        if (isNaN(birth.getTime())) return { age: 0 };
        const eventDate = new Date('2027-01-31');
        let age = eventDate.getFullYear() - birth.getFullYear();
        const m = eventDate.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && eventDate.getDate() < birth.getDate())) {
            age--;
        }
        return { age: Math.max(0, age) };
    }

    function normalizeShirtType(rawType) {
        const val = String(rawType || '').trim().toUpperCase();
        if (val === 'LONG' || rawType === 'แขนยาว') return 'แขนยาว';
        return 'แขนสั้น';
    }

    // แปลงฟิลด์ข้อมูลนักวิ่งให้รองรับทั้งชื่อฟิลด์จาก Google Sheets และหน้าเว็บเดิม
    function normalizeRunner(r) {
        if (!r || typeof r !== 'object') return r;
        const firstName = String(r.firstName || '').trim();
        const lastName = String(r.lastName || '').trim();
        const fullName = String(r.fullName || `${firstName} ${lastName}`.trim()).trim();
        const idCard = String(r.idCard || r.nationalId || '').trim();
        const shirtType = normalizeShirtType(r.shirtType || r.sleeveType);
        const emergencyContact = String(r.emergencyContact || r.emergencyName || '').trim();
        const medicalConditions = String(r.medicalConditions || r.medicalInfo || '').trim() || 'ไม่มี';

        return Object.assign({}, r, {
            firstName,
            lastName,
            fullName,
            idCard,
            nationalId: idCard,
            shirtType,
            sleeveType: r.sleeveType || (shirtType === 'แขนยาว' ? 'LONG' : 'SHORT'),
            emergencyContact,
            emergencyName: emergencyContact,
            medicalConditions,
            medicalInfo: medicalConditions
        });
    }

    function calculateFee(category, shirtType = 'แขนสั้น') {
        const categoryInfo = CATEGORIES[category] || CATEGORIES['5K'];
        const normalizedType = normalizeShirtType(shirtType);
        const extra = (normalizedType === 'แขนยาว') ? LONG_SLEEVE_SURCHARGE : 0;
        return categoryInfo.price + extra;
    }

    function splitFullName(fullName) {
        const cleaned = String(fullName || '').trim().replace(/\s+/g, ' ');
        if (!cleaned) return { firstName: '', lastName: '' };
        const parts = cleaned.split(' ');
        if (parts.length === 1) return { firstName: parts[0], lastName: '-' };
        return {
            firstName: parts[0],
            lastName: parts.slice(1).join(' ')
        };
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

    async function findExistingByIdCard(idCard) {
        const cleanId = (idCard || '').trim();
        if (!cleanId) return null;

        if (GOOGLE_SCRIPT_URL) {
            try {
                const res = await callGoogleScript('search', { keyword: cleanId }, 'GET');
                if (res && res.success && Array.isArray(res.runners)) {
                    const found = res.runners.find(r => String(r.idCard || r.nationalId || '').trim() === cleanId);
                    return found ? normalizeRunner(found) : null;
                }
            } catch (e) {
                console.warn('Google Sheets ID check error:', e);
            }
            return null;
        }

        const db = loadDB();
        const found = db.registrations.find(r => (r.idCard || r.nationalId) === cleanId);
        return found ? normalizeRunner(found) : null;
    }

    function cacheLastRegistered(runnerObj) {
        try {
            if (!runnerObj) return;
            const jsonStr = JSON.stringify(runnerObj);
            sessionStorage.setItem('LAST_REGISTERED_DATA', jsonStr);
            localStorage.setItem('LAST_REGISTERED_DATA', jsonStr);
            if (runnerObj.idCard) {
                sessionStorage.setItem('LAST_REGISTERED_ID', runnerObj.idCard);
                localStorage.setItem('LAST_REGISTERED_ID', runnerObj.idCard);
            }
            if (runnerObj.id) {
                sessionStorage.setItem('LAST_REGISTERED_REG_ID', runnerObj.id);
                localStorage.setItem('LAST_REGISTERED_REG_ID', runnerObj.id);
            }
        } catch (e) {}
    }

    async function createRegistration(data = {}) {
        const parsedName = splitFullName(data.fullName);
        const firstName = String(data.firstName || parsedName.firstName || '').trim();
        const lastName = String(data.lastName || parsedName.lastName || '').trim();
        const idCard = String(data.idCard || data.nationalId || '').trim();

        const computedAge = (data.age !== undefined && data.age !== '')
            ? Number(data.age)
            : calculateAge(data.birthDate).age;
        const shirtType = normalizeShirtType(data.shirtType || data.sleeveType);
        const slipUrl = data.slipUrl || data.slipBase64 || '';
        const slipHash = data.slipHash || computeHash(slipUrl);
        const totalAmount = Number(data.amount) || calculateFee(data.category, shirtType);

        const emergencyContact = String(data.emergencyContact || data.emergencyName || '').trim();
        const emergencyPhone = String(data.emergencyPhone || '').trim();
        const medicalConditions = String(data.medicalConditions || data.medicalInfo || '').trim() || 'ไม่มี';

        if (GOOGLE_SCRIPT_URL) {
            const res = await callGoogleScript('register', {
                category: data.category,
                firstName,
                lastName,
                fullName: data.fullName || `${firstName} ${lastName}`.trim(),
                idCard,
                nationalId: idCard,
                gender: data.gender,
                birthDate: data.birthDate,
                age: computedAge,
                shirtSize: data.shirtSize,
                shirtType,
                sleeveType: data.sleeveType || (shirtType === 'แขนยาว' ? 'LONG' : 'SHORT'),
                phone: String(data.phone || '').trim(),
                email: String(data.email || '').trim(),
                province: String(data.province || '').trim(),
                bloodType: data.bloodType || 'ไม่ระบุ',
                emergencyContact,
                emergencyPhone,
                medicalConditions,
                transferDate: data.transferDate || '',
                transferTime: data.transferTime || '',
                base64Slip: slipUrl,
                slipHash,
                amount: totalAmount
            }, 'POST');

            if (res && res.success) {
                const createdData = normalizeRunner(Object.assign({
                    category: data.category,
                    firstName,
                    lastName,
                    fullName: data.fullName || `${firstName} ${lastName}`.trim(),
                    idCard,
                    gender: data.gender,
                    birthDate: data.birthDate,
                    age: computedAge,
                    shirtSize: data.shirtSize,
                    shirtType,
                    phone: String(data.phone || '').trim(),
                    email: String(data.email || '').trim(),
                    province: String(data.province || '').trim(),
                    emergencyContact,
                    emergencyPhone,
                    medicalConditions,
                    transferDate: data.transferDate || '',
                    transferTime: data.transferTime || '',
                    amount: totalAmount,
                    status: STATUS.PENDING
                }, res.data || {}));

                cacheLastRegistered(createdData);
                return createdData;
            } else {
                throw new Error((res && res.message) || 'บันทึกข้อมูลลง Google Sheets ไม่สำเร็จ');
            }
        }

        // Local Fallback (กรณีไม่ได้ตั้งค่า URL)
        const db = loadDB();
        const existing = db.registrations.find(r => (r.idCard || r.nationalId) === idCard);
        if (existing) {
            throw new Error(`เลขบัตรประชาชน / พาสปอร์ต ${idCard} มีการลงทะเบียนในระบบแล้ว`);
        }

        const regId = `KYR-2570-${String(db.registrations.length + 1).padStart(3, '0')}`;
        const newReg = normalizeRunner({
            id: regId,
            category: data.category,
            bibNumber: null,
            status: STATUS.PENDING,
            firstName,
            lastName,
            fullName: data.fullName || `${firstName} ${lastName}`.trim(),
            idCard,
            phone: String(data.phone || '').trim(),
            email: String(data.email || '').trim(),
            province: String(data.province || '').trim(),
            gender: data.gender,
            birthDate: data.birthDate,
            age: computedAge,
            shirtSize: data.shirtSize,
            shirtType,
            bloodType: data.bloodType || 'ไม่ระบุ',
            emergencyContact,
            emergencyPhone,
            medicalConditions,
            transferDate: data.transferDate || '',
            transferTime: data.transferTime || '',
            slipUrl,
            slipBase64: slipUrl,
            slipHash,
            amount: totalAmount,
            createdAt: new Date().toISOString(),
            approvedAt: null,
            adminNotes: ''
        });

        db.registrations.unshift(newReg);
        saveDB(db);
        cacheLastRegistered(newReg);
        return newReg;
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

        findExistingByIdCard,
        findByNationalId: findExistingByIdCard,

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

        // 1. CREATE REGISTRATION + ALIAS addRegistration
        createRegistration,
        addRegistration: createRegistration,

        // 2. APPROVE SLIP & ISSUE BIB
        async approveRegistration(regId, adminNotes = '') {
            if (GOOGLE_SCRIPT_URL) {
                const res = await callGoogleScript('approve', {
                    id: regId,
                    adminNotes,
                    siteUrl: getSiteBaseUrl()
                }, 'POST');
                if (res && res.success) {
                    const merged = normalizeRunner(Object.assign({}, res.data || res));
                    if (res.emailSent !== undefined) merged.emailSent = res.emailSent;
                    if (res.emailMessage !== undefined) merged.emailMessage = res.emailMessage;
                    return merged;
                }
                throw new Error((res && res.message) || 'อนุมัติไม่สำเร็จ');
            }

            const db = loadDB();
            const reg = db.registrations.find(r => r.id === regId);
            if (!reg) throw new Error('ไม่พบข้อมูลการลงทะเบียน');
            if (reg.status === STATUS.APPROVED && reg.bibNumber) return normalizeRunner(reg);

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
            return Object.assign(normalizeRunner(reg), {
                emailSent: false,
                emailMessage: 'โหมดจำลอง LocalStorage (ไม่ได้ส่งอีเมลจริง)'
            });
        },

        // 3. REJECT SLIP
        async rejectRegistration(regId, reason) {
            if (GOOGLE_SCRIPT_URL) {
                const res = await callGoogleScript('reject', {
                    id: regId,
                    reason,
                    siteUrl: getSiteBaseUrl()
                }, 'POST');
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
            return {
                success: true,
                data: normalizeRunner(reg),
                emailSent: false,
                emailMessage: 'โหมดจำลอง LocalStorage (ไม่ได้ส่งอีเมลจริง)'
            };
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
            return normalizeRunner(reg);
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
            if (updates.shirtType) reg.shirtType = normalizeShirtType(updates.shirtType);
            if (updates.amount !== undefined) reg.amount = Number(updates.amount);
            if (updates.phone) reg.phone = updates.phone.trim();
            if (updates.email !== undefined) reg.email = updates.email.trim();
            if (updates.emergencyContact) reg.emergencyContact = updates.emergencyContact.trim();
            if (updates.emergencyPhone) reg.emergencyPhone = updates.emergencyPhone.trim();
            if (updates.bloodType) reg.bloodType = updates.bloodType;
            if (updates.medicalConditions !== undefined) reg.medicalConditions = updates.medicalConditions.trim();

            reg.updatedAt = new Date().toISOString();
            saveDB(db);
            return normalizeRunner(reg);
        },

        // 6. SEARCH RUNNER
        async searchRunner(keyword) {
            const clean = (keyword || '').trim().toLowerCase();
            if (!clean) return [];

            if (GOOGLE_SCRIPT_URL) {
                const res = await callGoogleScript('search', { keyword: clean }, 'GET');
                if (res && res.success && Array.isArray(res.runners)) {
                    return res.runners.map(normalizeRunner);
                }
                return [];
            }

            const db = loadDB();
            return db.registrations
                .map(normalizeRunner)
                .filter(r =>
                    (r.idCard && r.idCard.toLowerCase().includes(clean)) ||
                    (r.phone && r.phone.includes(clean)) ||
                    (r.id && r.id.toLowerCase().includes(clean)) ||
                    (r.bibNumber && r.bibNumber.toLowerCase().includes(clean)) ||
                    (r.fullName && r.fullName.toLowerCase().includes(clean))
                );
        },

        // 7. GET ALL REGISTRATIONS
        async getAllRegistrations() {
            if (GOOGLE_SCRIPT_URL) {
                const res = await callGoogleScript('getAll', {}, 'GET');
                if (res && res.success && Array.isArray(res.runners)) {
                    _cachedRegistrations = res.runners.map(normalizeRunner);
                    return _cachedRegistrations;
                }
                return [];
            }
            const db = loadDB();
            return db.registrations.map(normalizeRunner);
        },

        // 8. GET SUMMARY STATS
        async getStats() {
            if (GOOGLE_SCRIPT_URL) {
                callGoogleScript('getAll', {}, 'GET').then(r => {
                    if (r && r.success && Array.isArray(r.runners)) {
                        _cachedRegistrations = r.runners.map(normalizeRunner);
                    }
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
                if (normalizeShirtType(r.shirtType || r.sleeveType) === 'แขนยาว') {
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
                'เลขบัตร ปชช.', 'เบอร์โทร', 'อีเมล', 'เพศ', 'อายุ',
                'ไซส์เสื้อ', 'รูปแบบเสื้อ', 'หมู่เลือด', 'โรคประจำตัว', 'ผู้ติดต่อฉุกเฉิน', 'เบอร์ฉุกเฉิน',
                'ยอดเงิน (บาท)', 'วันที่สมัคร', 'วันที่อนุมัติ', 'วันที่โอนเงิน', 'เวลาที่โอนเงิน'
            ];

            const rows = list.map(r => [
                r.bibNumber || 'รออนุมัติ',
                r.id,
                r.status,
                r.category,
                r.firstName,
                r.lastName,
                `'${r.idCard || r.nationalId || ''}`,
                `'${r.phone || ''}`,
                r.email || '-',
                r.gender,
                r.age,
                r.shirtSize,
                normalizeShirtType(r.shirtType || r.sleeveType),
                r.bloodType,
                `"${(r.medicalConditions || r.medicalInfo || '-').replace(/"/g, '""')}"`,
                r.emergencyContact || r.emergencyName || '',
                `'${r.emergencyPhone || ''}`,
                r.amount,
                r.createdAt ? r.createdAt.slice(0, 10) : '-',
                r.approvedAt ? r.approvedAt.slice(0, 10) : '-',
                r.transferDate || '-',
                r.transferTime || '-'
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
   2. UNIFIED TOPBAR DROPDOWN & MOBILE MENU CONTROLLER
   3. MOBILE BOTTOM QUICK-ACTION BAR (<= 768px)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    const siteNav = document.querySelector('.site-nav');
    if (siteNav) {
        if (!siteNav.querySelector('.nav-scroll-progress')) {
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

        const mobileToggleBtn = document.getElementById('mobileToggle');
        const navMenuEl = document.getElementById('navMenu');

        if (navMenuEl && navMenuEl.dataset.topbarInit !== '1') {
            navMenuEl.dataset.topbarInit = '1';

            const closeAllDropdowns = () => {
                navMenuEl.querySelectorAll('.nav-dropdown.open').forEach((dd) => {
                    dd.classList.remove('open');
                    const toggleBtn = dd.querySelector('.nav-dropdown-toggle');
                    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
                });
            };

            const closeMobileMenu = () => {
                navMenuEl.classList.remove('open');
                if (mobileToggleBtn) mobileToggleBtn.setAttribute('aria-expanded', 'false');
                closeAllDropdowns();
            };

            if (mobileToggleBtn) {
                mobileToggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isOpen = navMenuEl.classList.toggle('open');
                    mobileToggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                    if (!isOpen) closeAllDropdowns();
                });
            }

            navMenuEl.querySelectorAll('.nav-dropdown-toggle').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    const isLink = btn.tagName === 'A' && btn.getAttribute('href');
                    const isTouchOrMobile = window.matchMedia('(max-width: 1080px), (hover: none)').matches;

                    if (!isLink || isTouchOrMobile) {
                        e.preventDefault();
                        e.stopPropagation();
                        const parentDd = btn.closest('.nav-dropdown');
                        if (!parentDd) return;
                        const willOpen = !parentDd.classList.contains('open');
                        closeAllDropdowns();
                        if (willOpen) {
                            parentDd.classList.add('open');
                            btn.setAttribute('aria-expanded', 'true');
                        }
                    } else {
                        closeAllDropdowns();
                    }
                });
            });

            navMenuEl.querySelectorAll('a:not(.nav-dropdown-toggle)').forEach((link) => {
                link.addEventListener('click', () => {
                    closeMobileMenu();
                });
            });

            document.addEventListener('click', (e) => {
                if (!siteNav.contains(e.target)) {
                    closeMobileMenu();
                }
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    closeMobileMenu();
                }
            });
        }
    }

    if (!document.querySelector('.mobile-bottom-bar')) {
        const currentPage = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
        const bottomBar = document.createElement('nav');
        bottomBar.className = 'mobile-bottom-bar';
        bottomBar.setAttribute('aria-label', 'เมนูลัดสำหรับมือถือ');

        if (currentPage === 'admin.html') {
            bottomBar.innerHTML = `
                <a href="#fastReview" class="mobile-quick-item">
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