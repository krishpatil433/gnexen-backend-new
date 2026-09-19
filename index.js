// ============================================================
// GNEXEN REWARD - COMPLETE BACKEND (FIXED)
// Supabase + FaucetPay + c.cx.ua + BitcoTasks
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// SUPABASE CONFIG
// ============================================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const USD_TO_COINS = 10000;
const FAUCETPAY_API_URL = 'https://faucetpay.io/api/v1';

// ============================================================
// OFFERWALL CONFIG
// ============================================================
const BITCOTASKS_API_KEY = process.env.BITCOTASKS_API_KEY;
const BITCOTASKS_BEARER_TOKEN = process.env.BITCOTASKS_BEARER_TOKEN;

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());

// ✅ Debug middleware
app.use((req, res, next) => {
    if (req.path.includes('webhook') || req.path.includes('withdraw')) {
        console.log('🔍 ===== REQUEST DEBUG =====');
        console.log('   Path:', req.path);
        console.log('   Method:', req.method);
        console.log('   Content-Type:', req.headers['content-type']);
        console.log('   ===========================');
    }
    next();
});

// ✅ Raw body parser for webhook endpoints
app.use('/api/offerwall-webhook', express.raw({ type: '*/*', limit: '10mb' }));
app.use('/api/bitcotasks-webhook', express.raw({ type: '*/*', limit: '10mb' }));

// ✅ JSON aur URL-encoded parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Custom parser - handles multipart + urlencoded + json
app.use((req, res, next) => {
    if (req.path.includes('webhook') && Buffer.isBuffer(req.body)) {
        const bodyString = req.body.toString();
        const contentType = req.headers['content-type'] || '';
        
        console.log('🔍 Raw Body length:', bodyString.length);
        
        // Parse based on content type
        if (contentType.includes('application/json')) {
            try { req.body = JSON.parse(bodyString); } catch (e) { req.body = {}; }
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
            try { req.body = Object.fromEntries(new URLSearchParams(bodyString)); } catch (e) { req.body = {}; }
        } else if (contentType.includes('multipart/form-data')) {
            // ✅ Manual multipart parser
            req.body = parseMultipartFormData(bodyString, contentType);
        } else {
            // Try all formats
            try { req.body = JSON.parse(bodyString); } catch (e1) {
                try { req.body = Object.fromEntries(new URLSearchParams(bodyString)); } catch (e2) { req.body = {}; }
            }
        }
        
        console.log('📦 Parsed body:', JSON.stringify(req.body));
    }
    next();
});

// ✅ Multipart form-data parser
function parseMultipartFormData(bodyString, contentType) {
    const result = {};
    
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) return result;
    
    const boundary = '--' + boundaryMatch[1].trim();
    const parts = bodyString.split(boundary);
    
    for (const part of parts) {
        const nameMatch = part.match(/name="([^"]+)"/);
        if (!nameMatch) continue;
        
        const name = nameMatch[1];
        const valueMatch = part.match(/\r\n\r\n([\s\S]*?)\r\n$/);
        if (!valueMatch) continue;
        
        const value = valueMatch[1].trim();
        result[name] = value;
    }
    
    return result;
}

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'GNEXEN Backend', timestamp: new Date().toISOString() });
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

async function creditCoins(userId, coinsToAdd, amountUSD, description, referenceId, type = 'offerwall_reward') {
    try {
        const { data: user, error: userError } = await supabase
            .from('users').select('coins, total_earned').eq('uid', userId).single();
            
        if (userError || !user) {
            console.error('❌ User not found:', userId);
            return { success: false, error: 'User not found' };
        }
        
        const updatedCoins = (user.coins || 0) + coinsToAdd;
        const updatedEarned = (user.total_earned || 0) + amountUSD;
        
        console.log(`💰 Updating user ${userId}: ${user.coins} + ${coinsToAdd} = ${updatedCoins} coins`);
        
        const { error: updateError } = await supabase
            .from('users')
            .update({
                coins: updatedCoins,
                total_earned: updatedEarned,
                updated_at: new Date().toISOString()
            })
            .eq('uid', userId);
            
        if (updateError) {
            console.error('❌ Update error:', updateError);
            return { success: false, error: updateError.message };
        }
        
        await supabase.from('transactions').insert({
            user_id: userId, type, amount: amountUSD, coins: coinsToAdd,
            currency: 'USD', description, status: 'completed',
            reference_id: referenceId || 'tx_' + Date.now(),
            created_at: new Date().toISOString()
        });
        
        console.log(`✅ Credited ${coinsToAdd} coins to user ${userId}`);
        return { success: true, newCoins: updatedCoins };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ============================================================
// c.cx.ua OFFERWALL POSTBACK
// ============================================================
app.post('/api/offerwall-webhook', async (req, res) => {
    try {
        console.log('📥 ===== C.CX.UA POSTBACK =====');
        
        let data = {};
        if (req.body && typeof req.body === 'object') data = { ...data, ...req.body };
        if (req.query && Object.keys(req.query).length > 0) data = { ...data, ...req.query };
        
        console.log('   Merged data:', JSON.stringify(data));
        
        const subId = data.subId || data.sub_id || data.user_id;
        const transId = data.transId || data.trans_id;
        const reward = data.reward || data.amount || data.payout;
        const status = data.status || '1';
        const offer_name = data.offer_name;
        const offer_type = data.offer_type;
        
        if (!subId || !reward) {
            console.error('❌ Missing subId or reward');
            return res.status(400).send('ERROR: Missing parameters');
        }
        
        const rewardAmount = parseFloat(reward);
        const coinsToAdd = Math.round(rewardAmount * USD_TO_COINS);
        
        if (status === '2') {
            // Chargeback
            const { data: user } = await supabase.from('users').select('coins').eq('uid', subId).single();
            if (user) {
                await supabase.from('users').update({
                    coins: Math.max(0, (user.coins || 0) - coinsToAdd)
                }).eq('uid', subId);
            }
            return res.send('ok');
        }
        
        const result = await creditCoins(
            subId, coinsToAdd, rewardAmount,
            `c.cx.ua: ${offer_name || offer_type || 'Offer'} (${transId})`,
            transId, 'offerwall_reward'
        );
        
        if (!result.success) {
            return res.status(500).send('ERROR: ' + result.error);
        }
        
        res.send('ok');
    } catch (error) {
        console.error('❌ c.cx.ua postback error:', error);
        res.status(500).send('ERROR: ' + error.message);
    }
});

app.get('/api/offerwall-webhook', (req, res) => {
    res.json({ success: true, message: 'c.cx.ua webhook is active', timestamp: new Date().toISOString() });
});

// ============================================================
// BITCOTASKS POSTBACK
// ============================================================
app.post('/api/bitcotasks-webhook', async (req, res) => {
    try {
        console.log('📥 ===== BITCOTASKS POSTBACK =====');
        
        let data = {};
        if (req.body && typeof req.body === 'object') data = { ...data, ...req.body };
        if (req.query && Object.keys(req.query).length > 0) data = { ...data, ...req.query };
        
        console.log('   Merged data:', JSON.stringify(data));
        
        const subId = data.subId || data.sub_id;
        const transId = data.transId || data.trans_id;
        const reward = data.reward;
        const status = data.status || '1';
        const offer_name = data.offer_name;
        const offer_type = data.offer_type;
        
        if (!subId || !reward) {
            console.error('❌ Missing subId or reward');
            return res.status(400).send('ERROR: Missing parameters');
        }
        
        const rewardAmount = parseFloat(reward);
        const coinsToAdd = Math.round(rewardAmount * USD_TO_COINS);
        
        if (status === '2') {
            const { data: user } = await supabase.from('users').select('coins').eq('uid', subId).single();
            if (user) {
                await supabase.from('users').update({
                    coins: Math.max(0, (user.coins || 0) - coinsToAdd)
                }).eq('uid', subId);
            }
            return res.send('ok');
        }
        
        const result = await creditCoins(
            subId, coinsToAdd, rewardAmount,
            `BitcoTasks: ${offer_name || offer_type || 'Offer'} (${transId})`,
            transId, 'offerwall_reward'
        );
        
        if (!result.success) {
            return res.status(500).send('ERROR: ' + result.error);
        }
        
        res.send('ok');
    } catch (error) {
        console.error('❌ BitcoTasks postback error:', error);
        res.status(500).send('ERROR: ' + error.message);
    }
});

app.get('/api/bitcotasks-webhook', (req, res) => {
    res.json({ success: true, message: 'BitcoTasks webhook is active', timestamp: new Date().toISOString() });
});

// ============================================================
// FAUCETPAY PAYMENT PROCESSING - FIXED
// ============================================================
async function processFaucetPayment(withdrawalId, userId, account, amount) {
    try {
        console.log(`💰 ===== FAUCETPAY PAYMENT =====`);
        console.log(`   Withdrawal ID: ${withdrawalId}`);
        console.log(`   Account: ${account}`);
        console.log(`   Amount USD: ${amount}`);
        
        const { data: settings } = await supabase
            .from('settings').select('value').eq('key', 'faucetpay').single();
            
        const config = settings?.value || {};
        
        if (!config.api_key) {
            console.log('❌ FaucetPay API Key not configured');
            await supabase.from('withdrawals').update({
                status: 'failed', error: 'FaucetPay API Key not configured'
            }).eq('id', withdrawalId);
            return;
        }
        
        await supabase.from('withdrawals').update({
            status: 'processing', processed_at: new Date().toISOString()
        }).eq('id', withdrawalId);
        
        // ✅ Convert USD to smallest unit
        const currency = (config.currency || 'USDT').toUpperCase();
        let amountInSmallestUnit;
        
        const decimals = {
            'USDT': 6,
            'BTC': 8,
            'LTC': 8,
            'DOGE': 8,
            'ETH': 18,
            'TRX': 6,
            'BCH': 8,
            'DASH': 8,
            'DGB': 8,
            'ZEC': 8,
            'SOL': 9,
            'BNB': 8,
            'FEY': 8,
            'USDC': 6
        };
        
        const decimalPlaces = decimals[currency] || 8;
        amountInSmallestUnit = Math.round(amount * Math.pow(10, decimalPlaces));
        
        console.log(`💱 Currency: ${currency} (${decimalPlaces} decimals)`);
        console.log(`💱 Amount in smallest unit: ${amountInSmallestUnit}`);
        
        // ✅ Build form-encoded data
        const params = new URLSearchParams();
        params.append('api_key', config.api_key);
        params.append('amount', amountInSmallestUnit.toString());
        params.append('to', account);
        params.append('currency', currency);
        if (config.username) {
            params.append('referral', config.username);
        }
        
        console.log('📤 Sending to FaucetPay API...');
        
        const response = await axios.post(
            `${FAUCETPAY_API_URL}/send`,
            params.toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000
            }
        );
        
        console.log('📥 FaucetPay Response:');
        console.log('   Status:', response.data?.status);
        console.log('   Message:', response.data?.message);
        
        // ✅ Status 200 = success
        if (response.data?.status === 200) {
            await supabase.from('withdrawals').update({
                status: 'paid',
                transaction_id: response.data.payout_id?.toString() || 'fp_' + Date.now(),
                paid_at: new Date().toISOString()
            }).eq('id', withdrawalId);
            console.log(`✅ FaucetPay payment successful #${withdrawalId}`);
        } else {
            const errorMsg = response.data?.message || `Status ${response.data?.status}`;
            console.log('❌ FaucetPay error:', errorMsg);
            throw new Error(errorMsg);
        }
    } catch (error) {
        console.error('❌ FaucetPay error:', error.message);
        if (error.response) {
            console.error('   Response:', JSON.stringify(error.response.data));
        }
        
        await supabase.from('withdrawals').update({
            status: 'failed', error: error.message
        }).eq('id', withdrawalId);
        
        // Refund coins
        const wDoc = await supabase.from('withdrawals')
            .select('coins_deducted, user_id').eq('id', withdrawalId).single();
        if (wDoc.data) {
            const { data: user } = await supabase.from('users')
                .select('coins').eq('uid', wDoc.data.user_id).single();
            if (user) {
                await supabase.from('users').update({
                    coins: (user.coins || 0) + (wDoc.data.coins_deducted || 0)
                }).eq('uid', wDoc.data.user_id);
                console.log('↩️ Coins refunded');
            }
        }
    }
}

// ============================================================
// WITHDRAWAL APIs
// ============================================================
app.post('/api/withdraw', async (req, res) => {
    try {
        console.log('💸 ===== WITHDRAWAL REQUEST =====');
        console.log('   Body:', JSON.stringify(req.body));
        
        const { userId, method, account, amount, giftValue } = req.body;
        
        if (!userId || !method || !account || !amount) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        const { data: user, error: userError } = await supabase
            .from('users').select('coins, balance, total_withdrawn').eq('uid', userId).single();
            
        if (userError || !user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        const requiredCoins = Math.round(amount * USD_TO_COINS);
        
        if (user.coins < requiredCoins) {
            return res.status(400).json({
                success: false,
                error: `Insufficient coins! You have ${user.coins}, need ${requiredCoins}`
            });
        }
        
        const { data: withdrawal, error } = await supabase.from('withdrawals').insert({
            user_id: userId, method, account, amount,
            coins_deducted: requiredCoins,
            gift_value: giftValue || null,
            status: 'pending',
            created_at: new Date().toISOString()
        }).select().single();
        
        if (error) throw error;
        
        await supabase.from('users').update({
            coins: user.coins - requiredCoins,
            total_withdrawn: (user.total_withdrawn || 0) + amount,
            updated_at: new Date().toISOString()
        }).eq('uid', userId);
        
        if (method === 'faucetpay') {
            processFaucetPayment(withdrawal.id, userId, account, amount);
        }
        
        res.json({ success: true, withdrawal, message: 'Withdrawal request submitted' });
    } catch (error) {
        console.error('Withdrawal error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/api/withdrawals/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { data: withdrawals, error } = await supabase
            .from('withdrawals').select('*').eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, withdrawals });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        const { data: withdrawals, error } = await supabase
            .from('withdrawals').select('*, users(name, email)')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, withdrawals });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.put('/api/admin/withdrawal/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, giftCardCode } = req.body;
        
        const updateData = { status, processed_at: new Date().toISOString() };
        if (giftCardCode) updateData.gift_card_code = giftCardCode;
        if (status === 'paid') updateData.paid_at = new Date().toISOString();
        
        const { data, error } = await supabase
            .from('withdrawals').update(updateData).eq('id', id).select();
        if (error) throw error;
        
        res.json({ success: true, withdrawal: data[0] });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============================================================
// USER APIs
// ============================================================
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, referral } = req.body;
        
        const { data: existingUser } = await supabase
            .from('users').select('email').eq('email', email).single();

        if (existingUser) {
            return res.status(400).json({ success: false, error: 'Email already registered' });
        }

        const { data, error } = await supabase.auth.signUp({
            email, password, options: { data: { name } }
        });
        
        if (error) throw error;
        
        const user = data.user;
        const refCode = 'GNX' + Math.random().toString(36).substring(2, 8).toUpperCase();
        
        await supabase.from('users').insert({
            uid: user.id, name, email, coins: 0, balance: 0,
            total_earned: 0, total_withdrawn: 0, completed_tasks: 0,
            referral_code: refCode, referred_by: referral || null,
            referral_earnings: 0, status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

        res.json({ success: true, user: { id: user.id, uid: user.id, name, email, referralCode: refCode, coins: 0 } });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        
        const { data: userProfile } = await supabase
            .from('users').select('*').eq('uid', data.user.id).single();
            
        if (!userProfile) {
            return res.status(404).json({ success: false, error: 'User profile not found' });
        }
        
        res.json({ success: true, user: userProfile, session: data.session });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/api/user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const { data: user, error } = await supabase
            .from('users').select('*').eq('uid', uid).single();
        if (error) return res.status(404).json({ success: false, error: 'User not found' });
        res.json({ success: true, user });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.put('/api/user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const { name, status } = req.body;
        const updateData = { updated_at: new Date().toISOString() };
        if (name) updateData.name = name;
        if (status) updateData.status = status;
        
        const { data, error } = await supabase
            .from('users').update(updateData).eq('uid', uid).select();
        if (error) throw error;
        res.json({ success: true, user: data[0] });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.put('/api/admin/user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const { status } = req.body;
        const { data, error } = await supabase
            .from('users').update({ status, updated_at: new Date().toISOString() })
            .eq('uid', uid).select();
        if (error) throw error;
        res.json({ success: true, user: data[0] });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============================================================
// TASK, PTC, SHORTLINK APIs (Basic)
// ============================================================

app.get('/api/tasks', async (req, res) => {
    try {
        const { data: tasks, error } = await supabase
            .from('tasks').select('*').eq('status', 'active')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, tasks });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/api/complete-task', async (req, res) => {
    try {
        const { userId, taskId, reward } = req.body;
        if (!userId || !taskId) {
            return res.status(400).json({ success: false, error: 'Missing fields' });
        }
        
        const coinsToAdd = Math.round((reward || 0) * USD_TO_COINS);
        const result = await creditCoins(userId, coinsToAdd, reward || 0,
            `Task completed: ${taskId}`, taskId, 'task_reward');
        
        if (!result.success) {
            return res.status(400).json({ success: false, error: result.error });
        }
        
        const { data: updatedUser } = await supabase
            .from('users').select('*').eq('uid', userId).single();
        
        res.json({ success: true, coins: coinsToAdd, newBalance: updatedUser?.coins || 0, user: updatedUser });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/api/ptc-ads', async (req, res) => {
    try {
        const { data: ptcAds, error } = await supabase
            .from('ptc_ads').select('*').eq('status', 'active')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, ptcAds });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/api/shortlinks', async (req, res) => {
    try {
        const { data: shortlinks, error } = await supabase
            .from('shortlinks').select('*').eq('status', 'active')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, shortlinks });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/api/shortlink/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data: shortlink, error } = await supabase
            .from('shortlinks').select('*').eq('id', id).single();
        if (error) return res.status(404).json({ success: false, error: 'Not found' });
        
        supabase.from('shortlinks').update({
            total_clicks: (shortlink.total_clicks || 0) + 1
        }).eq('id', id).then(() => {}).catch(() => {});
        
        res.json({ success: true, url: shortlink.shortlink_url, reward: shortlink.reward });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============================================================
// LEADERBOARD
// ============================================================
app.get('/api/leaderboard', async (req, res) => {
    try {
        const { data: leaderboard, error } = await supabase
            .from('users').select('name, coins, completed_tasks, total_earned')
            .order('coins', { ascending: false }).limit(10);
        if (error) throw error;
        res.json({ success: true, leaderboard: leaderboard || [] });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message, leaderboard: [] });
    }
});

// ============================================================
// ADMIN APIs
// ============================================================
app.get('/api/admin/users', async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('users').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, users });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get('/api/settings/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const { data: settings, error } = await supabase
            .from('settings').select('value').eq('key', key).single();
        if (error) throw error;
        res.json({ success: true, settings: settings?.value || {} });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.put('/api/admin/settings/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const { value } = req.body;
        
        const { data, error } = await supabase.from('settings').update({
            value, updated_at: new Date().toISOString()
        }).eq('key', key).select();
        
        if (error) {
            const { data: insertData, error: insertError } = await supabase
                .from('settings').insert({
                    key, value, updated_at: new Date().toISOString()
                }).select();
            if (insertError) throw insertError;
            return res.json({ success: true, settings: insertData[0] });
        }
        res.json({ success: true, settings: data[0] });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 GNEXEN REWARD Backend`);
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🔑 Supabase connected`);
    console.log(`✅ Server ready!`);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});
