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
const submitBtnText = document.getElementById('submitBtnText');
const seqNumber = document.getElementById('sequenceNumber');
const stripePayBtn = document.getElementById('stripePayBtn');

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

let currentPlan = 'trial';

// Handle plan change
planRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        currentPlan = e.target.value;
        if (currentPlan === 'full') {
            dataCheckgroup.style.display = 'block';
            checkoutSummary.style.display = 'block';
            trialCheckgroup.style.display = 'none';
            submitBtnText.textContent = '支付定金并生成排期密匙';

            checkPhoto.required = true;
            checkVideo.required = true;
            checkAudio.required = true;
            checkTrialData.required = false;
        } else {
            dataCheckgroup.style.display = 'none';
            checkoutSummary.style.display = 'none';
            trialCheckgroup.style.display = 'block';
            submitBtnText.textContent = '提交基础数据并开启体验';

            checkPhoto.required = false;
            checkVideo.required = false;
            checkAudio.required = false;
            checkTrialData.required = true;
        }
    });
});

// TODO: 将这里的 URL 替换为您在 Stripe Dashboard 中创建的 Payment Link (Payment Links > Create)
const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/test_YOUR_LINK_HERE";

applyForm.addEventListener('submit', (e) => {
    e.preventDefault();

    // Animate button
    const originalText = submitBtnText.textContent;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在连接量子计算机...';
    submitBtn.style.opacity = '0.8';
    submitBtn.disabled = true;

    // Simulate process
    setTimeout(() => {
        // Generate random sequence
        const rand = Math.floor(10000 + Math.random() * 90000);
        seqNumber.textContent = `DL-2058-${rand}`;

        if (currentPlan === 'full') {
            modalTitle.textContent = '授权申请已收录';
            modalDesc.innerHTML = '请完成定金支付以正式锁定 550W 算力周期。<br>当前算力预估需要等待：<span class="highlight">1.4 年</span><br><br><small style="color: rgba(255,255,255,0.5);"><i class="fa-solid fa-lock"></i> 支付由 Stripe 提供企业级安全加密保障</small>';
            stripePayBtn.style.display = 'inline-flex';
        } else {
            modalTitle.textContent = '体验资料上传通道已开启';
            modalDesc.innerHTML = '您的试用档案已建立。请后续上传您的 1 张照片和 10 秒以上语音记录。<br>审核通过后约 <span class="highlight">15 分钟</span> 即可生成您的专属数字生命对话链接。';
            stripePayBtn.style.display = 'none';
        }

        // Show Modal
        modal.classList.add('active');

        // Setup Stripe Button link
        if (STRIPE_PAYMENT_LINK.includes("YOUR_LINK_HERE")) {
            // Placeholder behavior if link is not set
            stripePayBtn.onclick = (e) => {
                e.preventDefault();
                alert("在此处会跳转到 Stripe 支付界面！请在 script.js 中替换实际的 Stripe Payment Link。");
            };
        } else {
            // Actual redirect behavior
            stripePayBtn.href = STRIPE_PAYMENT_LINK;
        }

        // Reset form btn
        submitBtn.innerHTML = `<span class="btn-text" id="submitBtnText">${originalText}</span><i class="fa-solid fa-fingerprint"></i>`;
        submitBtn.style.opacity = '1';
        submitBtn.disabled = false;
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
    }, 2000);
});

window.closeModal = () => {
    modal.classList.remove('active');
};
