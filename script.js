// --- Particle Canvas Background ---
const canvas = document.getElementById('particleCanvas');
const ctx = canvas.getContext('2d');

let particles = [];
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

class Particle {
    constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.vx = (Math.random() - 0.5) * 1;
        this.vy = (Math.random() - 0.5) * 1;
        this.size = Math.random() * 2 + 0.5;
        this.color = Math.random() > 0.8 ? '#00f3ff' : 'rgba(0, 243, 255, 0.3)';
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;

        // Bounce off edges
        if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
        if (this.y < 0 || this.y > canvas.height) this.vy *= -1;

        // Mouse interaction
        let dx = mouseX - this.x;
        let dy = mouseY - this.y;
        let distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 100) {
            this.x -= dx * 0.01;
            this.y -= dy * 0.01;
        }
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
    }
}

function initParticles() {
    particles = [];
    let numParticles = Math.floor(window.innerWidth * window.innerHeight / 10000);
    for (let i = 0; i < numParticles; i++) {
        particles.push(new Particle());
    }
}

function animateParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw connecting lines
    for (let i = 0; i < particles.length; i++) {
        for (let j = i; j < particles.length; j++) {
            let dx = particles[i].x - particles[j].x;
            let dy = particles[i].y - particles[j].y;
            let distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 80) {
                ctx.beginPath();
                ctx.strokeStyle = `rgba(0, 243, 255, ${0.2 - distance / 400})`;
                ctx.lineWidth = 0.5;
                ctx.moveTo(particles[i].x, particles[i].y);
                ctx.lineTo(particles[j].x, particles[j].y);
                ctx.stroke();
            }
        }
    }

    particles.forEach(p => {
        p.update();
        p.draw();
    });

    requestAnimationFrame(animateParticles);
}

window.addEventListener('mousemove', (e) => {
    mouseX = e.x;
    mouseY = e.y;
});

initParticles();
animateParticles();

// --- Scroll Animation ---
const observers = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('appear');
        }
    });
}, { threshold: 0.1 });

document.querySelectorAll('.fade-in').forEach(el => observers.observe(el));


// --- Form Submission & Modal (Stripe Integration Prep) ---
const applyForm = document.getElementById('applyForm');
const modal = document.getElementById('successModal');
const submitBtn = document.getElementById('submitBtn');
const getSubmitBtnText = () => document.getElementById('submitBtnText');
const seqNumber = document.getElementById('sequenceNumber');
const stripePaymentForm = document.getElementById('stripe-payment-form');
const submitStripeBtn = document.getElementById('submitStripeBtn');

// Initialize Stripe UI
const stripe = Stripe('pk_test_YOUR_STRIPE_PUBLIC_KEY');
const elements = stripe.elements();
const cardElement = elements.create('card', {
    style: {
        base: {
            color: '#ffffff',
            fontFamily: '"Noto Sans SC", sans-serif',
            fontSmoothing: 'antialiased',
            fontSize: '16px',
            iconColor: '#00f3ff',
            '::placeholder': {
                color: '#a0b0c0'
            }
        },
        invalid: {
            color: '#ff3333',
            iconColor: '#ff3333'
        }
    }
});
cardElement.mount('#card-element');

cardElement.on('change', function (event) {
    const displayError = document.getElementById('card-errors');
    if (event.error) {
        displayError.textContent = event.error.message;
    } else {
        displayError.textContent = '';
    }
});

if (submitStripeBtn) {
    submitStripeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        submitStripeBtn.disabled = true;
        submitStripeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 加密通信连接中...';

        // Simulate creating a payment token via Stripe.js (Safe to run without a backend)
        const { token, error } = await stripe.createToken(cardElement);

        if (error) {
            const errorElement = document.getElementById('card-errors');
            errorElement.textContent = error.message;
            submitStripeBtn.disabled = false;
            submitStripeBtn.innerHTML = '<i class="fa-brands fa-stripe" style="font-size: 1.5rem; margin-right: 5px;"></i> 安全支付 1,500,000 信用点';
        } else {
            // Success Demo Effect
            setTimeout(() => {
                alert('支付授权成功！您刚刚生成了一个安全的 Stripe Token: ' + token.id + '。（注：由于此页面为纯前端 GitHub Pages，此交易处于演示模式，未产生实际收费。如需真实扣款需配合后端接口。）');
                closeModal();
                submitStripeBtn.disabled = false;
                submitStripeBtn.innerHTML = '<i class="fa-brands fa-stripe" style="font-size: 1.5rem; margin-right: 5px;"></i> 安全支付 1,500,000 信用点';
                cardElement.clear();
            }, 1000);
        }
    });
}

const planRadios = document.querySelectorAll('input[name="planType"]');
const trialCheckgroup = document.getElementById('trialCheckgroup');
const dataCheckgroup = document.getElementById('dataCheckgroup');
const checkoutSummary = document.getElementById('checkoutSummary');
const checkPhoto = document.getElementById('checkPhoto');
const checkVideo = document.getElementById('checkVideo');
const checkAudio = document.getElementById('checkAudio');
const checkTrialData = document.getElementById('checkTrialData');
const modalTitle = modal.querySelector('h2');
const modalDesc = modal.querySelector('.modal-desc');
let latestFullPlanContext = null;

let currentPlan = 'trial';
const PAGE_CONFIG = window.DIGITAL_LIFE_CONFIG || {};
const CONTROL_PLANE_BASE_URL = String(PAGE_CONFIG.controlPlaneBaseUrl || '').trim().replace(/\/+$/, '');
const TELEGRAM_BOT_USERNAME = String(PAGE_CONFIG.telegramBotUsername || 'splandour_550w_bot').trim();

function generateFallbackUid() {
    const rand = Math.floor(100000 + Math.random() * 900000);
    return `UID-550W-${rand}`;
}

function defaultDeepLink(uid) {
    return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${uid}`;
}

async function submitApplyOrder() {
    const payload = {
        planType: currentPlan,
        applicant: document.getElementById('applicant').value.trim(),
        subject: document.getElementById('subject').value.trim(),
        relation: document.getElementById('relation').value.trim(),
        message: document.getElementById('message').value.trim(),
        source: 'landing'
    };

    if (!CONTROL_PLANE_BASE_URL) {
        const uid = generateFallbackUid();
        return {
            uid,
            telegramDeepLink: defaultDeepLink(uid),
            fallback: true
        };
    }

    const res = await fetch(`${CONTROL_PLANE_BASE_URL}/api/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.uid) {
        throw new Error(data.error || 'apply_failed');
    }

    return {
        uid: data.uid,
        telegramDeepLink: data.telegramDeepLink || defaultDeepLink(data.uid),
        statusUrl: data.statusUrl || '',
        paymentStatus: data.paymentStatus || '',
        fallback: false
    };
}

function normalizePaymentStatus(status) {
    const raw = String(status || '').trim().toLowerCase();
    if (!raw) return 'unknown';
    return raw;
}

function paymentStatusText(status) {
    const map = {
        pending: '待支付',
        paid: '已支付',
        waived: '已豁免',
        failed: '支付失败',
        refunded: '已退款',
        canceled: '已取消',
        unknown: '未知'
    };
    return map[normalizePaymentStatus(status)] || status;
}

function upsertImDeepLinkButton(href, labelText) {
    let imBtn = document.getElementById('imDeepLinkBtn');
    if (!imBtn) {
        imBtn = document.createElement('a');
        imBtn.id = 'imDeepLinkBtn';
        imBtn.className = 'cta-btn m-top';
        imBtn.style.display = 'flex';
        imBtn.style.width = '100%';
        imBtn.style.justifyContent = 'center';
        imBtn.style.fontSize = '1.1rem';
        stripePaymentForm.parentNode.insertBefore(imBtn, stripePaymentForm.nextSibling);
    }
    imBtn.innerHTML = '<i class="fa-brands fa-telegram" style="font-size: 1.5rem; margin-right: 10px;"></i> ' + labelText;
    imBtn.href = href;
}

function removeImDeepLinkButton() {
    const existingImBtn = document.getElementById('imDeepLinkBtn');
    if (existingImBtn) existingImBtn.remove();
}

function ensureFullPlanStatusPanel() {
    let panel = document.getElementById('fullPlanStatusPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'fullPlanStatusPanel';
        panel.style.marginTop = '12px';
        panel.style.padding = '12px';
        panel.style.borderRadius = '8px';
        panel.style.border = '1px solid var(--glass-border)';
        panel.style.background = 'rgba(0, 0, 0, 0.25)';
        panel.style.fontSize = '0.9rem';
        stripePaymentForm.parentNode.insertBefore(panel, stripePaymentForm.nextSibling);
    }
    return panel;
}

function removeFullPlanStatusPanel() {
    const panel = document.getElementById('fullPlanStatusPanel');
    if (panel) panel.remove();
}

async function refreshFullPlanPaymentState() {
    if (!latestFullPlanContext || !latestFullPlanContext.statusUrl) return;
    const panel = ensureFullPlanStatusPanel();
    const btn = panel.querySelector('#refreshPaymentBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '正在查询...';
    }

    try {
        const res = await fetch(latestFullPlanContext.statusUrl, { method: 'GET' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || 'status_query_failed');
        }
        const paymentStatus = normalizePaymentStatus(data?.order?.paymentStatus || latestFullPlanContext.paymentStatus || 'unknown');
        latestFullPlanContext.paymentStatus = paymentStatus;

        const canEnterIm = paymentStatus === 'paid' || paymentStatus === 'waived';
        panel.innerHTML = `
            <div><strong>订单状态：</strong>${paymentStatusText(paymentStatus)}</div>
            <div style="margin-top: 8px; opacity: 0.75;">UID：${latestFullPlanContext.uid}</div>
            <button id="refreshPaymentBtn" class="cta-btn m-top" style="width:100%; justify-content:center; font-size:0.95rem;">刷新支付状态</button>
        `;
        panel.querySelector('#refreshPaymentBtn').onclick = refreshFullPlanPaymentState;

        if (canEnterIm) {
            upsertImDeepLinkButton(latestFullPlanContext.telegramDeepLink, '接入 Telegram 唤醒终端');
        } else {
            removeImDeepLinkButton();
        }
    } catch (err) {
        panel.innerHTML = `
            <div><strong>订单状态查询失败</strong>：${String(err.message || err)}</div>
            <button id="refreshPaymentBtn" class="cta-btn m-top" style="width:100%; justify-content:center; font-size:0.95rem;">重试查询</button>
        `;
        panel.querySelector('#refreshPaymentBtn').onclick = refreshFullPlanPaymentState;
    }
}

// Handle plan change
planRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        currentPlan = e.target.value;
        if (currentPlan === 'full') {
            dataCheckgroup.style.display = 'block';
            checkoutSummary.style.display = 'block';
            trialCheckgroup.style.display = 'none';
            getSubmitBtnText().textContent = '支付定金并生成排期密匙';

            checkPhoto.required = true;
            checkVideo.required = true;
            checkAudio.required = true;
            checkTrialData.required = false;
        } else {
            dataCheckgroup.style.display = 'none';
            checkoutSummary.style.display = 'none';
            trialCheckgroup.style.display = 'block';
            getSubmitBtnText().textContent = '提交基础数据并开启体验';

            checkPhoto.required = false;
            checkVideo.required = false;
            checkAudio.required = false;
            checkTrialData.required = true;
        }
    });
});

// Removed dummy stripe payment link

applyForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Animate button
    const originalText = getSubmitBtnText().textContent;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在连接量子计算机...';
    submitBtn.style.opacity = '0.8';
    submitBtn.disabled = true;

    try {
        // Keep a short animation even when backend responds very quickly
        await new Promise(resolve => setTimeout(resolve, 800));
        const applyResult = await submitApplyOrder();
        const uid = applyResult.uid;
        seqNumber.textContent = uid;
        seqNumber.setAttribute('data-text', uid); // For glitch effect

        if (currentPlan === 'full') {
            modalTitle.textContent = '算力排期请求已建立';
            modalDesc.innerHTML = '新生命构建从确认您的专属 UID 开始。<br>请完成定金支付以正式锁定 550W 算力周期，当前算力预估需要等待：<span class="highlight">1.4 年</span><br><br><small style="color: rgba(255,255,255,0.5);"><i class="fa-solid fa-lock"></i> 支付由 Stripe 提供企业级安全加密保障</small>';
            stripePaymentForm.style.display = 'block';
            removeImDeepLinkButton();
            latestFullPlanContext = {
                uid,
                statusUrl: applyResult.statusUrl || '',
                paymentStatus: normalizePaymentStatus(applyResult.paymentStatus || 'unknown'),
                telegramDeepLink: applyResult.telegramDeepLink || defaultDeepLink(uid)
            };
            const panel = ensureFullPlanStatusPanel();
            panel.innerHTML = `
                <div><strong>订单状态：</strong>${paymentStatusText(latestFullPlanContext.paymentStatus)}</div>
                <div style="margin-top: 8px; opacity: 0.75;">UID：${uid}</div>
                <button id="refreshPaymentBtn" class="cta-btn m-top" style="width:100%; justify-content:center; font-size:0.95rem;">刷新支付状态</button>
            `;
            panel.querySelector('#refreshPaymentBtn').onclick = refreshFullPlanPaymentState;
            if (!latestFullPlanContext.statusUrl) {
                panel.innerHTML += '<div style="margin-top: 8px; color: #ffad33;">当前为演示模式，后端状态查询不可用。</div>';
            }
            const canEnterImDirectly = latestFullPlanContext.paymentStatus === 'paid' || latestFullPlanContext.paymentStatus === 'waived';
            if (canEnterImDirectly) {
                upsertImDeepLinkButton(latestFullPlanContext.telegramDeepLink, '接入 Telegram 唤醒终端');
            }

        } else {
            modalTitle.textContent = '体验生命基座已初始化';
            modalDesc.innerHTML = `新生命构建从确认专属 UID 开始。您的体验档案已挂载至虚拟空间。<br><br>
                <div style="text-align: left; background: rgba(0,0,0,0.3); padding: 15px; border-radius: 4px; border-left: 3px solid var(--cyan); margin-top: 15px; font-size: 0.9rem;">
                    <strong>[系统提示]</strong> 拦截到 550W 初始化请求。请即刻通过专属通讯链路验证您的身份。<br>
                    点击下方按钮进入加密终端，发送您的影像与声音特征。
                </div>`;
            stripePaymentForm.style.display = 'none';
            removeFullPlanStatusPanel();
            latestFullPlanContext = null;

            // Generate IM Deep Link Button (e.g., Telegram)
            const deepLinkUrl = applyResult.telegramDeepLink || defaultDeepLink(uid);
            upsertImDeepLinkButton(deepLinkUrl, '接入 Telegram 唤醒终端');

            if (applyResult.fallback) {
                modalDesc.innerHTML += '<br><small style="color:#ffad33;"><i class="fa-solid fa-triangle-exclamation"></i> 当前后端不可用，已使用本地演示 UID。</small>';
            } else if (applyResult.statusUrl) {
                modalDesc.innerHTML += `<br><small style="color: rgba(255,255,255,0.65);">状态查询：${applyResult.statusUrl}</small>`;
            }
        }

        // Show Modal
        modal.classList.add('active');
        applyForm.reset();

        // Reset to default plan state
        currentPlan = 'trial';
        dataCheckgroup.style.display = 'none';
        checkoutSummary.style.display = 'none';
        trialCheckgroup.style.display = 'block';
        checkPhoto.required = false;
        checkVideo.required = false;
        checkAudio.required = false;
        checkTrialData.required = true;
    } catch (err) {
        console.error('submit apply order failed:', err);
        alert('提交失败：后端暂时不可用，请稍后重试。');
    } finally {
        // Reset form btn
        submitBtn.innerHTML = `<span class="btn-text" id="submitBtnText">${originalText}</span><i class="fa-solid fa-fingerprint"></i>`;
        submitBtn.style.opacity = '1';
        submitBtn.disabled = false;
    }
});

window.closeModal = () => {
    modal.classList.remove('active');
    removeFullPlanStatusPanel();
    latestFullPlanContext = null;
};
