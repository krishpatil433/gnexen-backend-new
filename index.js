require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Config
const supabaseUrl = process.env.SUPABASE_URL || 'https://ogkavpsfbihxbodvzppj.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_W4JV0K8shyAgOE0BUG6WPw_teElLVsE';
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(express.json());

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'GNEXEN Backend', timestamp: new Date().toISOString() });
});

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, referral } = req.body;
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: { data: { name: name } }
        });
        if (error) throw error;
        const user = data.user;
        const refCode = 'GNX' + Math.random().toString(36).substring(2, 8).toUpperCase();
        
        await supabase.from('users').insert({
            uid: user.id,
            name: name,
            email: email,
            balance: 0,
            total_earned: 0,
            total_withdrawn: 0,
            completed_tasks: 0,
            referral_code: refCode,
            referred_by: referral || null,
            referral_earnings: 0,
            status: 'active'
        });
        res.json({ success: true, user: { id: user.id, name, email, referralCode: refCode } });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });
        if (error) throw error;
        const { data: userProfile } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();
        res.json({ success: true, user: userProfile, session: data.session });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Get User Data
app.get('/api/user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('uid', uid)
            .single();
        if (error) throw error;
        res.json({ success: true, user: user });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Update User
app.put('/api/user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const { name } = req.body;
        const { data, error } = await supabase
            .from('users')
            .update({ name: name })
            .eq('uid', uid)
            .select();
        if (error) throw error;
        res.json({ success: true, user: data[0] });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Create Withdrawal
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, method, account, amount, giftValue } = req.body;
        const { data: user } = await supabase
            .from('users')
            .select('balance')
            .eq('uid', userId)
            .single();
        if (!user) throw new Error('User not found');
        if (user.balance < amount) throw new Error('Insufficient balance');
        
        const { data: withdrawal, error } = await supabase
            .from('withdrawals')
            .insert({
                user_id: userId,
                method: method,
                account: account,
                amount: amount,
                gift_value: giftValue || null,
                status: 'pending',
                created_at: new Date().toISOString()
            })
            .select()
            .single();
        if (error) throw error;
        
        await supabase
            .from('users')
            .update({ balance: user.balance - amount })
            .eq('uid', userId);
        
        if (method === 'faucetpay') {
            processFaucetPayment(withdrawal.id, userId, account, amount);
        }
        res.json({ success: true, withdrawal: withdrawal });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Process FaucetPay Payment
async function processFaucetPayment(withdrawalId, userId, account, amount) {
    try {
        const { data: settings } = await supabase
            .from('settings')
            .select('value')
            .eq('key', 'faucetpay')
            .single();
        const config = settings?.value || {};
        if (!config.api_key) {
            console.log('FaucetPay API Key not configured');
            return;
        }
        await supabase
            .from('withdrawals')
            .update({ status: 'processing', processed_at: new Date().toISOString() })
            .eq('id', withdrawalId);
        
        const response = await axios.post('https://faucetpay.io/api/v1/send', null, {
            params: {
                api_key: config.api_key,
                to: account,
                amount: amount,
                currency: config.currency || 'USDT',
                referrer: config.username || '',
                memo: `GNEXEN Withdrawal #${withdrawalId}`
            },
            timeout: 30000
        });
        if (response.data && response.data.status === 'success') {
            await supabase
                .from('withdrawals')
                .update({ status: 'paid', transaction_id: response.data.txn_id || 'fp_' + Date.now(), paid_at: new Date().toISOString() })
                .eq('id', withdrawalId);
            console.log(`Payment successful #${withdrawalId}`);
        } else {
            throw new Error(response.data?.message || 'Payment failed');
        }
    } catch (error) {
        console.error('Payment error:', error);
        await supabase
            .from('withdrawals')
            .update({ status: 'failed', error: error.message })
            .eq('id', withdrawalId);
    }
}

// Get Withdrawals
app.get('/api/withdrawals/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { data: withdrawals, error } = await supabase
            .from('withdrawals')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, withdrawals: withdrawals });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Get Shortlinks
app.get('/api/shortlinks', async (req, res) => {
    try {
        const { data: shortlinks, error } = await supabase
            .from('shortlinks')
            .select('*')
            .eq('status', 'active');
        if (error) throw error;
        res.json({ success: true, shortlinks: shortlinks });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Get PTC Ads
app.get('/api/ptc-ads', async (req, res) => {
    try {
        const { data: ptcAds, error } = await supabase
            .from('ptc_ads')
            .select('*')
            .eq('status', 'active');
        if (error) throw error;
        res.json({ success: true, ptcAds: ptcAds });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Get Tasks
app.get('/api/tasks', async (req, res) => {
    try {
        const { data: tasks, error } = await supabase
            .from('tasks')
            .select('*')
            .eq('status', 'active');
        if (error) throw error;
        res.json({ success: true, tasks: tasks });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Complete Task
app.post('/api/complete-task', async (req, res) => {
    try {
        const { userId, taskId, reward } = req.body;
        const { data: user } = await supabase
            .from('users')
            .select('balance, total_earned, completed_tasks')
            .eq('uid', userId)
            .single();
        if (!user) throw new Error('User not found');
        await supabase
            .from('users')
            .update({
                balance: user.balance + reward,
                total_earned: (user.total_earned || 0) + reward,
                completed_tasks: (user.completed_tasks || 0) + 1
            })
            .eq('uid', userId);
        res.json({ success: true, message: 'Task completed!' });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log('🔑 Supabase connected');
});
