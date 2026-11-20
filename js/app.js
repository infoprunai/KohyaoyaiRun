/**
 * Run Open Sea Kohyao - Registration System
 * งานวิ่งเปิดโลกการท่องเที่ยว เกาะยาวใหญ่ ประจำปี 2570
 * 
 * Full client-side registration system with localStorage persistence
 */

(function () {
    'use strict';

    // ===== CONFIG =====
    const CONFIG = {
        EVENT_NAME: 'วิ่งเปิดโลกทะเล',
        EVENT_YEAR: 2570,
        BIB_PREFIX_5K: 'A',
        BIB_PREFIX_10K: 'B',
        BIB_START_5K: 1,
        BIB_START_10K: 1,
        STORAGE_KEY: 'kohyao_run_registrations',
        SIZES: ['SS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
        MAX_REGISTRATIONS: 2000,
    };

    // ===== STATE =====
    let registrations = [];
    let currentFilter = 'all';

    // ===== INIT =====
    document.addEventListener('DOMContentLoaded', () => {
        loadRegistrations();
        initNavbar();
        initScrollAnimations();
        initForm();
        renderRegistrationTable();
        updateStats();
        initParticles();
        initBackToTop();
        initCountUp();
    });

    // ===== DATA PERSISTENCE =====
    function loadRegistrations() {
        try {
            const data = localStorage.getItem(CONFIG.STORAGE_KEY);
            registrations = data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Error loading registrations:', e);
            registrations = [];
        }
    }

    function saveRegistrations() {
        try {
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(registrations));
        } catch (e) {
            console.error('Error saving registrations:', e);
            showToast('เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'error');
        }
    }

    // ===== BIB NUMBER GENERATION =====
    function generateBibNumber(category) {
        const prefix = category === '5K' ? CONFIG.BIB_PREFIX_5K : CONFIG.BIB_PREFIX_10K;
        const start = category === '5K' ? CONFIG.BIB_START_5K : CONFIG.BIB_START_10K;
        const categoryRegs = registrations.filter(r => r.category === category);
        const nextNum = start + categoryRegs.length;
        return `${prefix}${String(nextNum).padStart(4, '0')}`;
    }

    // ===== NAVBAR =====
    function initNavbar() {
        const navbar = document.querySelector('.navbar');
        const hamburger = document.querySelector('.hamburger');
        const navLinks = document.querySelector('.nav-links');

        // Scroll effect
        window.addEventListener('scroll', () => {
            if (window.scrollY > 50) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
        });

        // Hamburger toggle
        if (hamburger) {
            hamburger.addEventListener('click', () => {
                navLinks.classList.toggle('active');
                hamburger.classList.toggle('active');
            });
        }

        // Close mobile nav on link click
        document.querySelectorAll('.nav-links a').forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('active');
                hamburger.classList.remove('active');
            });
        });

        // Active nav link on scroll
        const sections = document.querySelectorAll('section[id]');
        window.addEventListener('scroll', () => {
            let current = '';
            sections.forEach(section => {
                const sectionTop = section.offsetTop - 100;
                if (window.scrollY >= sectionTop) {
                    current = section.getAttribute('id');
                }
            });
            document.querySelectorAll('.nav-links a').forEach(a => {
                a.classList.remove('active');
                if (a.getAttribute('href') === `#${current}`) {
                    a.classList.add('active');
                }
            });
        });
    }

    // ===== SCROLL ANIMATIONS =====
    function initScrollAnimations() {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('visible');
                    }
                });
            },
            { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
        );

        document.querySelectorAll('.animate-on-scroll').forEach(el => {
            observer.observe(el);
        });
    }

    // ===== REGISTRATION FORM =====
    function initForm() {
        const form = document.getElementById('registrationForm');
        if (!form) return;

        form.addEventListener('submit', handleSubmit);

        // Real-time validation
        form.querySelectorAll('.form-control').forEach(input => {
            input.addEventListener('blur', () => validateField(input));
            input.addEventListener('input', () => {
                if (input.classList.contains('error')) {
                    validateField(input);
                }
            });
        });

        // Phone number formatting
        const phoneInput = form.querySelector('#phone');
        if (phoneInput) {
            phoneInput.addEventListener('input', (e) => {
                let val = e.target.value.replace(/\D/g, '');
                if (val.length > 10) val = val.slice(0, 10);
                e.target.value = val;
            });
        }

        // ID card formatting
        const idCardInput = form.querySelector('#idCard');
        if (idCardInput) {
            idCardInput.addEventListener('input', (e) => {
                let val = e.target.value.replace(/\D/g, '');
                if (val.length > 13) val = val.slice(0, 13);
                e.target.value = val;
            });
        }
    }

    function validateField(input) {
        const value = input.value.trim();
        let isValid = true;
        let message = '';

        if (input.hasAttribute('required') && !value) {
            isValid = false;
            message = 'กรุณากรอกข้อมูลนี้';
        } else if (input.id === 'phone' && value) {
            if (!/^0\d{8,9}$/.test(value)) {
                isValid = false;
                message = 'เบอร์โทรศัพท์ไม่ถูกต้อง';
            }
        } else if (input.id === 'idCard' && value) {
            if (!/^\d{13}$/.test(value)) {
                isValid = false;
                message = 'เลขบัตรประชาชนต้อง 13 หลัก';
            }
        } else if (input.id === 'email' && value) {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                isValid = false;
                message = 'อีเมลไม่ถูกต้อง';
            }
        } else if (input.id === 'age' && value) {
            const age = parseInt(value);
            if (age < 5 || age > 100) {
                isValid = false;
                message = 'อายุต้องอยู่ระหว่าง 5 - 100 ปี';
            }
        }

        if (!isValid) {
            input.classList.add('error');
            input.style.borderColor = '#ff6b6b';
            // Remove existing error message
            const existingMsg = input.parentElement.querySelector('.field-error');
            if (existingMsg) existingMsg.remove();
            // Add error message
            const errorEl = document.createElement('span');
            errorEl.className = 'field-error';
            errorEl.style.cssText = 'color:#ff6b6b;font-size:0.8rem;margin-top:4px;display:block;';
            errorEl.textContent = message;
            input.parentElement.appendChild(errorEl);
        } else {
            input.classList.remove('error');
            input.style.borderColor = '';
            const existingMsg = input.parentElement.querySelector('.field-error');
            if (existingMsg) existingMsg.remove();
        }

        return isValid;
    }

    function handleSubmit(e) {
        e.preventDefault();

        const form = e.target;
        const submitBtn = form.querySelector('.btn-submit');
        const spinner = submitBtn.querySelector('.spinner');

        // Validate all fields
        let isValid = true;
        form.querySelectorAll('.form-control[required]').forEach(input => {
            if (!validateField(input)) isValid = false;
        });

        // Check category selection
        const category = form.querySelector('input[name="category"]:checked');
        if (!category) {
            showToast('กรุณาเลือกประเภทการวิ่ง', 'error');
            return;
        }

        // Check shirt size
        const shirtSize = form.querySelector('input[name="shirtSize"]:checked');
        if (!shirtSize) {
            showToast('กรุณาเลือกไซส์เสื้อ', 'error');
            return;
        }

        // Check terms
        const terms = form.querySelector('#terms');
        if (terms && !terms.checked) {
            showToast('กรุณายอมรับเงื่อนไขการสมัคร', 'error');
            return;
        }

        if (!isValid) {
            showToast('กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง', 'error');
            return;
        }

        // Check duplicate ID card
        const idCard = form.querySelector('#idCard').value.trim();
        if (idCard && registrations.some(r => r.idCard === idCard)) {
            showToast('เลขบัตรประชาชนนี้ได้สมัครแล้ว', 'error');
            return;
        }

        // Disable submit button
        submitBtn.disabled = true;
        if (spinner) spinner.style.display = 'inline-block';

        // Simulate processing delay
        setTimeout(() => {
            const catValue = category.value;
            const bibNumber = generateBibNumber(catValue);

            const registration = {
                id: Date.now(),
                bibNumber: bibNumber,
                category: catValue,
                prefix: form.querySelector('#prefix').value,
                firstName: form.querySelector('#firstName').value.trim(),
                lastName: form.querySelector('#lastName').value.trim(),
                age: parseInt(form.querySelector('#age').value),
                gender: form.querySelector('#gender').value,
                idCard: idCard,
                phone: form.querySelector('#phone').value.trim(),
                email: form.querySelector('#email').value.trim(),
                shirtSize: shirtSize.value,
                bloodType: form.querySelector('#bloodType') ? form.querySelector('#bloodType').value : '',
                emergencyContact: form.querySelector('#emergencyContact') ? form.querySelector('#emergencyContact').value.trim() : '',
                emergencyPhone: form.querySelector('#emergencyPhone') ? form.querySelector('#emergencyPhone').value.trim() : '',
                medicalConditions: form.querySelector('#medicalConditions') ? form.querySelector('#medicalConditions').value.trim() : '',
                registeredAt: new Date().toISOString(),
            };

            registrations.push(registration);
            saveRegistrations();
            renderRegistrationTable();
            updateStats();

            // Show success modal
            showSuccessModal(registration);

            // Reset form
            form.reset();
            submitBtn.disabled = false;
            if (spinner) spinner.style.display = 'none';

            showToast(`สมัครสำเร็จ! หมายเลขบิบ: ${bibNumber}`, 'success');
        }, 1200);
    }

    // ===== SUCCESS MODAL =====
    function showSuccessModal(reg) {
        const modal = document.getElementById('successModal');
        if (!modal) return;

        const bibDisplay = modal.querySelector('.bib-display');
        const bibClass = reg.category === '5K' ? 'bib-5k-modal' : 'bib-10k-modal';
        bibDisplay.className = `bib-display ${bibClass}`;
        bibDisplay.textContent = reg.bibNumber;

        // Fill summary
        modal.querySelector('.sum-name').textContent = `${reg.prefix}${reg.firstName} ${reg.lastName}`;
        modal.querySelector('.sum-category').textContent = `${reg.category} - ${reg.category === '5K' ? 'Fun Run' : 'Mini Marathon'}`;
        modal.querySelector('.sum-size').textContent = reg.shirtSize;
        modal.querySelector('.sum-date').textContent = formatThaiDate(reg.registeredAt);

        modal.querySelector('.modal-overlay').classList.add('active');

        // Close handlers
        modal.querySelector('.modal-close').onclick = () => {
            modal.querySelector('.modal-overlay').classList.remove('active');
        };
        modal.querySelector('.modal-overlay').addEventListener('click', (e) => {
            if (e.target === modal.querySelector('.modal-overlay')) {
                modal.querySelector('.modal-overlay').classList.remove('active');
            }
        });
    }

    // ===== REGISTRATION TABLE =====
    function renderRegistrationTable() {
        const tbody = document.getElementById('regTableBody');
        const emptyState = document.getElementById('emptyState');
        if (!tbody) return;

        let filtered = registrations;
        if (currentFilter !== 'all') {
            filtered = registrations.filter(r => r.category === currentFilter);
        }

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        // Search filter
        const searchInput = document.getElementById('searchInput');
        if (searchInput && searchInput.value.trim()) {
            const query = searchInput.value.trim().toLowerCase();
            filtered = filtered.filter(r =>
                r.bibNumber.toLowerCase().includes(query) ||
                r.firstName.toLowerCase().includes(query) ||
                r.lastName.toLowerCase().includes(query) ||
                r.phone.includes(query)
            );
        }

        tbody.innerHTML = filtered.map((reg, index) => `
            <tr>
                <td>
                    <span class="bib-badge ${reg.category === '5K' ? 'bib-5k' : 'bib-10k'}">
                        ${reg.bibNumber}
                    </span>
                </td>
                <td>${reg.prefix}${reg.firstName} ${reg.lastName}</td>
                <td>
                    <span class="category-badge ${reg.category === '5K' ? 'cat-badge-5k' : 'cat-badge-10k'}">
                        ${reg.category}
                    </span>
                </td>
                <td>${reg.age} ปี</td>
                <td>${reg.gender}</td>
                <td>${reg.shirtSize}</td>
                <td>${formatThaiDate(reg.registeredAt)}</td>
            </tr>
        `).join('');
    }

    // ===== STATS =====
    function updateStats() {
        const total = registrations.length;
        const count5k = registrations.filter(r => r.category === '5K').length;
        const count10k = registrations.filter(r => r.category === '10K').length;

        const totalEl = document.getElementById('statTotal');
        const el5k = document.getElementById('stat5K');
        const el10k = document.getElementById('stat10K');

        if (totalEl) animateNumber(totalEl, total);
        if (el5k) animateNumber(el5k, count5k);
        if (el10k) animateNumber(el10k, count10k);

        // Hero stats
        const heroTotal = document.getElementById('heroStatTotal');
        if (heroTotal) heroTotal.textContent = total.toLocaleString();
    }

    function animateNumber(el, target) {
        const current = parseInt(el.textContent) || 0;
        if (current === target) return;

        const duration = 600;
        const startTime = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(current + (target - current) * eased);

            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }

        requestAnimationFrame(update);
    }

    // ===== FILTER & SEARCH =====
    window.filterRegistrations = function (filter) {
        currentFilter = filter;
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        renderRegistrationTable();
    };

    window.searchRegistrations = function () {
        renderRegistrationTable();
    };

    // ===== TOAST NOTIFICATION =====
    function showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        if (!toast) return;

        const iconSvg = type === 'success' 
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><path d="M20 6L9 17l-5-5"/></svg>' 
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
        toast.innerHTML = `<span style="display:inline-flex; align-items:center;">${iconSvg}</span><span>${message}</span>`;
        toast.className = `toast show ${type}`;

        setTimeout(() => {
            toast.classList.remove('show');
        }, 4000);
    }

    // ===== PARTICLES =====
    function initParticles() {
        const container = document.querySelector('.particles');
        if (!container) return;

        for (let i = 0; i < 20; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            const size = Math.random() * 6 + 2;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.animationDuration = `${Math.random() * 15 + 10}s`;
            particle.style.animationDelay = `${Math.random() * 10}s`;
            container.appendChild(particle);
        }
    }

    // ===== BACK TO TOP =====
    function initBackToTop() {
        const btn = document.querySelector('.back-to-top');
        if (!btn) return;

        window.addEventListener('scroll', () => {
            btn.classList.toggle('show', window.scrollY > 500);
        });

        btn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ===== COUNT UP ON SCROLL =====
    function initCountUp() {
        const counters = document.querySelectorAll('.count-up');
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const target = parseInt(el.dataset.target) || 0;
                    animateNumber(el, target);
                    observer.unobserve(el);
                }
            });
        }, { threshold: 0.5 });

        counters.forEach(counter => observer.observe(counter));
    }

    // ===== UTILITIES =====
    function formatThaiDate(isoString) {
        const date = new Date(isoString);
        const thaiMonths = [
            'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
            'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
        ];
        const day = date.getDate();
        const month = thaiMonths[date.getMonth()];
        const year = date.getFullYear() + 543;
        return `${day} ${month} ${year}`;
    }

    // ===== SMOOTH SCROLL for category buttons =====
    window.scrollToRegister = function (category) {
        const regSection = document.getElementById('register');
        if (regSection) {
            regSection.scrollIntoView({ behavior: 'smooth' });
            // Pre-select category
            setTimeout(() => {
                const radio = document.querySelector(`input[name="category"][value="${category}"]`);
                if (radio) radio.checked = true;
            }, 600);
        }
    };

    // ===== EXPORT DATA (Admin) =====
    window.exportRegistrations = function () {
        if (registrations.length === 0) {
            showToast('ไม่มีข้อมูลผู้สมัคร', 'error');
            return;
        }

        const headers = ['หมายเลขบิบ', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'อายุ', 'เพศ', 'ประเภท', 'ไซส์เสื้อ', 'เบอร์โทร', 'อีเมล', 'เลขบัตรประชาชน', 'หมู่เลือด', 'ผู้ติดต่อฉุกเฉิน', 'เบอร์ฉุกเฉิน', 'โรคประจำตัว', 'วันที่สมัคร'];
        const rows = registrations.map(r => [
            r.bibNumber, r.prefix, r.firstName, r.lastName, r.age, r.gender,
            r.category, r.shirtSize, r.phone, r.email, r.idCard,
            r.bloodType, r.emergencyContact, r.emergencyPhone,
            r.medicalConditions, formatThaiDate(r.registeredAt)
        ]);

        // BOM for Thai encoding
        let csv = '\uFEFF' + headers.join(',') + '\n';
        rows.forEach(row => {
            csv += row.map(cell => `"${(cell || '').toString().replace(/"/g, '""')}"`).join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `registrations_kohyao_run_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        showToast('ส่งออกข้อมูลสำเร็จ!', 'success');
    };

})();
