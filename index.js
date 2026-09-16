// ============================================================
// GNEXEN REWARD - COMPLETE BACKEND
// Supabase + FaucetPay + c.cx.ua + BitcoTasks
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

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
// BITCOTASKS CONFIG
// ============================================================
const BITCOTASKS_API_KEY = process.env.BITCOTASKS_API_KEY;
const BITCOTASKS_BEARER_TOKEN = process.env.BITCOTASKS_BEARER_TOKEN;

app.use(cors());
app.use(express.json());

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'GNEXEN Backend',
        timestamp: new Date().toISOString() 
    });
});

// ============================================================
// USER APIs
// ============================================================

// 1. REGISTER
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, referral } = req.body;
        
        const { data: existingUser } = await supabase
            .from('users')
            .select('email')
            .eq('email', email)
            .single();

        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'Email already registered'
            });
        }

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
            coins: 0,
            balance: 0,
            total_earned: 0,
            total_withdrawn: 0,
            completed_tasks: 0,
            referral_code: refCode,
            referred_by: referral || null,
            referral_earnings: 0,
            status: 'active',
            created_at: new Date().toISOString()
        });

        res.json({ 
            success: true, 
            user: { id: user.id, name, email, referralCode: refCode, coins: 0 } 
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// 2. LOGIN
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
            .eq('uid', data.user.id)
            .single();
            
        if (!userProfile) {
            return res.status(404).json({ success: false, error: 'User profile not found' });
        }
        
        res.json({ success: true, user: userProfile, session: data.session });
        
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// 3. GET USER
app.get('/api/user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('uid', uid)
            .single();
            
        if (error) return res.status(404).json({ success: false, error: 'User not found' });
        res.json({ success: true, user });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// 4. UPDATE USER
app.put('/api/user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const { name, status } = req.body;
        const updateData = { updated_at: new Date().toISOString() };
        if (name) updateData.name = name;
        if (status) updateData.status = status;
        
        const { data, error } = await supabase
            .from('users')
            .update(updateData)
            .eq('uid', uid)
            .select();
            
        if (error) throw error;
        res.json({ success: true, user: data[0] });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// 5. ADMIN - UPDATE USER STATUS
app.put('/api/admin/user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const { status } = req.body;
        const { data, error } = await supabase
            .from('users')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('uid', uid)
            .select();
            
        if (error) throw error;
        res.json({ success: true, user: data[0] });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============================================================
// TASK APIs
// ============================================================

// 6. GET TASKS
app.get('/api/tasks', async (req, res) => {
    try {
        const { data: tasks, error } = await supabase
            .from('tasks')
            .select('*')
            .eq('status', 'active')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        res.json({ success: true, tasks });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// 7. COMPLETE TASK
app.post('/api/complete-task', async (req, res) => {
    try {
        const { userId, taskId, reward } = req.body;
        
        if (!userId || !taskId) {
            return res.status(400).json({ success: false, error: 'User ID and Task ID required' });
        }
        
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('coins, total_earned, completed_tasks')
            .eq('uid', userId)
            .single();
            
        if (userError || !user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        const coinsToAdd = Math.round(reward * USD_TO_COINS);
        
        await supabase.from('users').update({
            coins: (user.coins || 0) + coinsToAdd,
            total_earned: (user.total_earned || 0) + reward,
            completed_tasks: (user.completed_tasks || 0) + 1
        }).eq('uid', userId);
        
        await supabase.from('transactions').insert({
            user_id: userId,
            type: 'task_reward',
            amount: reward,
            coins: coinsToAdd,
            currency: 'USDT',
            description: `Task completed: ${taskId}`,
            status: 'completed',
            reference_id: taskId,
            created_at: new Date().toISOString()
        });
        
        const { data: updatedUser } = await supabase
            .from('users').select('*').eq('uid', userId).single();
        
        res.json({
            success: true,
            message: 'Task completed!',
            coins: coinsToAdd,
            newBalance: updatedUser?.coins || 0,
            user: updatedUser
        });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// 8. ADMIN - CREATE TASK
app.post('/api/admin/task', async (req, res) => {
    try {
        const { title, description, category, taskUrl, instructions, reward, status } = req.body;
        
        const { data, error } = await supabase.from('tasks').insert({
            title, description: description || '', category: category || 'general',
            task_url: taskUrl || '', instructions: instructions || '',
            reward, status: status || 'active',
            created_at: new Date().toISOString()
        }).select().single();
        
        if (error) throw error;
        res.json({ success: true, task: data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// 9. ADMIN - UPDATE TASK
app.put('/api/admin/task/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, category, taskUrl, instructions, reward, status } = req.body;
        
        const { data, error } = await supabase.from('tasks').update({
            title, description: description || '', category: category || 'general',
            task_url: taskUrl || '', instructions: instructions || '',
            reward, status, updated_at: new Date().toISOString()
        }).eq('id', id).select();
        
        if (error) throw error;
        res.json({ success: true, task: data[0] });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// 10. ADMIN - DELETE TASK
app.delete('/api/admin/task/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('tasks').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Task deleted' });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============================================================
// PTC ADS APIs
// ============================================================

// 11. GET PTC ADS
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

// 12. ADMIN - CREATE PTC AD
app.post('/api/admin/ptc-ad', async (req, res) => {
    try {
        const { title, description, destinationUrl, viewDuration, reward, status } = req.body;
        const { data, error } = await supabase.from('ptc_ads').insert({
            title, description: description || '', destination_url: destinationUrl,
            view_duration: viewDuration || 5, reward, status: status || 'active',
            total_clicks: 0, created_at: new Date().toISOString()
        }).select().single();
        if (error) throw error;
        res.json({ success: true, ptcAd: data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// 13. ADMIN - UPDATE PTC AD
app.put('/api/admin/ptc-ad/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, destinationUrl, viewDuration, reward, status } = req.body;
        const { data, error } = await supabase.from('ptc_ads').update({
            title, description: description || '', destination_url: destinationUrl,
            view_duration: viewDuration || 5, reward, status,
            updated_at: new Date().toISOString()
        }).eq('id', id).select();
        if (error) throw error;
        res.json({ success: true, ptcAd: data[0] });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// 14. ADMIN - DELETE PTC AD
app.delete('/api/admin/ptc-ad/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('ptc_ads').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'PTC Ad deleted' });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============================================================
// SHORTLINK APIs
// ============================================================

// 15. GET SHORTLINKS
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

// 16. GET SHORTLINK BY ID
app.get('/api/shortlink/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data: shortlink, error } = await supabase
            .from('shortlinks').select('*').eq('id', id).single();
        if (error) return res.status(404).json({ success: false, error: 'Shortlink not found' });
        
        supabase.from('shortlinks').update({
            total_clicks: (shortlink.total_clicks || 0) + 1,
            updated_at: new Date().toISOString()
        }).eq('id', id).then(() => {}).catch(() => {});
        
        res.json({ success: true, url: shortlink.shortlink_url, reward: shortlink.reward });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// 17. ADMIN - CREATE SHORTLINK
app.post('/api/admin/shortlink', async (req, res) => {
    try {
        const { title, provider, shortlink_url, api_key, reward, daily_limit, total_limit, status } = req.body;
        const { data, error } = await supabase.from('shortlinks').insert({
            title, provider: provider || 'custom', shortlink_url,
            api_key: api_key || '', reward,
            daily_limit: daily_limit || 0, total_limit: total_limit || 0,
            total_clicks: 0, status: status || 'active',
            created_at: new Date().toISOString()
        }).select().single();
        if (error) throw error;
        res.json({ success: true, shortlink: data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// 18. ADMIN - UPDATE SHORTLINK
app.put('/api/admin/shortlink/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, provider, shortlink_url, api_key, reward, daily_limit, total_limit, status } = req.body;
        const { data, error } = await supabase.from('shortlinks').update({
            title, provider: provider || 'custom', shortlink_url,
            api_key: api_key || '', reward,
            daily_limit: daily_limit || 0, total_limit: total_limit || 0,
            status, updated_at: new Date().toISOString()
        }).eq('id', id).select();
        if (error) throw error;
        res.json({ success: true, shortlink: data[0] });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// 19. ADMIN - DELETE SHORTLINK
app.delete('/api/admin/shortlink/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('shortlinks').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Shortlink deleted' });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============================================================
// BITCOTASKS PROXY APIs (YEH MISSING THAY!)
// ============================================================

// 20. BITCOTASKS PTC ADS PROXY
app.post('/api/bitcotasks/ptc', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ success: false, error: 'User ID required' });
        
        if (!BITCOTASKS_API_KEY || !BITCOTASKS_BEARER_TOKEN) {
            return res.status(400).json({ success: false, error: 'BitcoTasks API not configured' });
        }
        
        const userIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                       req.connection.remoteAddress || '0.0.0.0';
        
        const url = `https://bitcotasks.com/api/${BITCOTASKS_API_KEY}/${userId}/${userIP}`;
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${BITCOTASKS_BEARER_TOKEN}`,
                'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0'
            }
        });
        
        const data = await response.json();
        res.json({ success: true, data: data.data || [] });
        
    } catch (error) {
        console.error('BitcoTasks PTC error:', error);
        res.status(500).json({ success: false, error: error.message, data: [] });
    }
});

// 21. BITCOTASKS SHORTLINKS PROXY
app.post('/api/bitcotasks/shortlinks', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ success: false, error: 'User ID required' });
        
        if (!BITCOTASKS_API_KEY || !BITCOTASKS_BEARER_TOKEN) {
            return res.status(400).json({ success: false, error: 'BitcoTasks API not configured' });
        }
        
        const userIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                       req.connection.remoteAddress || '0.0.0.0';
        
        const url = `https://bitcotasks.com/sl-api/${BITCOTASKS_API_KEY}/${userId}/${userIP}`;
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${BITCOTASKS_BEARER_TOKEN}`,
                'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0'
            }
        });
        
        const data = await response.json();
        res.json({ success: true, data: data.data || [] });
        
    } catch (error) {
        console.error('BitcoTasks Shortlink error:', error);
        res.status(500).json({ success: false, error: error.message, data: [] });
    }
});

// 22. BITCOTASKS OFFERS PROXY
app.post('/api/bitcotasks/offers', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ success: false, error: 'User ID required' });
        
        const userIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                       req.connection.remoteAddress || '0.0.0.0';
        
        const url = `https://bitcotasks.com/offer-api.php?key=${BITCOTASKS_API_KEY}&sub_id=${userId}&ip=${userIP}`;
        
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${BITCOTASKS_BEARER_TOKEN}` }
        });
        
        const data = await response.json();
        res.json({ success: true, data: data.data || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message, data: [] });
    }
});

// 23. BITCOTASKS SURVEYS PROXY
app.post('/api/bitcotasks/surveys', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ success: false, error: 'User ID required' });
        
        const userIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                       req.connection.remoteAddress || '0.0.0.0';
        
        const url = `https://bitcotasks.com/survey-api.php?key=${BITCOTASKS_API_KEY}&sub_id=${userId}&ip=${userIP}`;
        
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${BITCOTASKS_BEARER_TOKEN}` }
        });
        
        const data = await response.json();
        res.json({ success: true, data: data.data || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message, data: [] });
    }
});

// ============================================================
// WITHDRAWAL APIs
// ============================================================

// 24. CREATE WITHDRAWAL
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, method, account, amount, giftValue } = req.body;
        
        const { data: user, error: userError } = await supabase
            .from('users').select('coins, balance').eq('uid', userId).single();
            
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
            total_withdrawn: (user.total_withdrawn || 0) + amount
        }).eq('uid', userId);
        
        if (method === 'faucetpay') {
            processFaucetPayment(withdrawal.id, userId, account, amount);
        }
        
        res.json({ success: true, withdrawal, message: 'Withdrawal request submitted' });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// 25. GET USER WITHDRAWALS
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

// 26. ADMIN - GET ALL WITHDRAWALS
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

// 27. ADMIN - UPDATE WITHDRAWAL
app.put('/api/admin/withdrawal/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, giftCardCode } = req.body;
        
        const updateData = {
            status, processed_at: new Date().toISOString()
        };
        
        if (giftCardCode) updateData.gift_card_code = giftCardCode;
        if (status === 'paid') updateData.paid_at = new Date().toISOString();
        
        const { data, error } = await supabase
            .from('withdrawals').update(updateData).eq('id', id).select();
        if (error) throw error;
        
        if (status === 'rejected') {
            const wDoc = await supabase.from('withdrawals')
                .select('coins_deducted, user_id').eq('id', id).single();
                
            if (wDoc.data && wDoc.data.coins_deducted) {
                const { data: user } = await supabase.from('users')
                    .select('coins').eq('uid', wDoc.data.user_id).single();
                if (user) {
                    await supabase.from('users').update({
                        coins: (user.coins || 0) + (wDoc.data.coins_deducted || 0)
                    }).eq('uid', wDoc.data.user_id);
                }
            }
        }
        
        res.json({ success: true, withdrawal: data[0] });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============================================================
// FAUCETPAY PAYMENT PROCESSING
// ============================================================
async function processFaucetPayment(withdrawalId, userId, account, amount) {
    try {
        const { data: settings } = await supabase
            .from('settings').select('value').eq('key', 'faucetpay').single();
            
        const config = settings?.value || {};
        
        if (!config.api_key) {
            await supabase.from('withdrawals').update({
                status: 'failed', error: 'FaucetPay API Key not configured'
            }).eq('id', withdrawalId);
            return;
        }
        
        await supabase.from('withdrawals').update({
            status: 'processing', processed_at: new Date().toISOString()
        }).eq('id', withdrawalId);
        
        const response = await axios.post(`${FAUCETPAY_API_URL}/send`, null, {
            params: {
                api_key: config.api_key, to: account, amount,
                currency: config.currency || 'USDT',
                referrer: config.username || '',
                memo: `GNEXEN Withdrawal #${withdrawalId}`
            },
            timeout: 30000
        });
        
        if (response.data?.status === 'success') {
            await supabase.from('withdrawals').update({
                status: 'paid',
                transaction_id: response.data.txn_id || 'fp_' + Date.now(),
                paid_at: new Date().toISOString()
            }).eq('id', withdrawalId);
        } else {
            throw new Error(response.data?.message || 'Payment failed');
        }
    } catch (error) {
        console.error('FaucetPay error:', error);
        await supabase.from('withdrawals').update({
            status: 'failed', error: error.message
        }).eq('id', withdrawalId);
    }
}

// ============================================================
// ADMIN - GET ALL USERS
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

// ============================================================
// FAUCET APIs (Optional - Agar Faucet Hata Diya Hai Toh Ignore Karein)
// ============================================================
app.get('/api/faucet-history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { data: history, error } = await supabase
            .from('faucet_history').select('*').eq('user_id', userId)
            .order('created_at', { ascending: false }).limit(50);
        if (error) throw error;
        res.json({ success: true, history: history || [] });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============================================================
// SETTINGS APIs
// ============================================================
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
// OFFERWALL POSTBACKS
// ============================================================

// c.cx.ua POSTBACK
app.post('/api/offerwall-webhook', async (req, res) => {
    try {
        const { subId, transId, offer_name, offer_type, reward, payout, status } = req.body;
        
        console.log('📥 c.cx.ua Postback:', { subId, transId, reward, status });
        
        if (status !== '1' || !subId || !reward) {
            return res.json({ success: false, error: 'Invalid status or missing fields' });
        }
        
        const rewardAmount = parseFloat(reward);
        const coinsToAdd = Math.round(rewardAmount * USD_TO_COINS);
        
        const { data: user, error: userError } = await supabase
            .from('users').select('coins, total_earned').eq('uid', subId).single();
            
        if (userError || !user) return res.status(404).json({ success: false, error: 'User not found' });
        
        await supabase.from('users').update({
            coins: (user.coins || 0) + coinsToAdd,
            total_earned: (user.total_earned || 0) + rewardAmount
        }).eq('uid', subId);
        
        await supabase.from('transactions').insert({
            user_id: subId, type: 'offerwall_reward',
            amount: rewardAmount, coins: coinsToAdd, currency: 'USD',
            description: `c.cx.ua: ${offer_name || offer_type || 'Offer'}`,
            status: 'completed', reference_id: transId,
            created_at: new Date().toISOString()
        });
        
        res.send('ok');
    } catch (error) {
        console.error('c.cx.ua postback error:', error);
        res.status(500).send('error');
    }
});

// BitcoTasks POSTBACK
app.post('/api/bitcotasks-webhook', async (req, res) => {
    try {
        const { subId, transId, offer_name, offer_type, reward, payout, status } = req.body;
        
        console.log('📥 BitcoTasks Postback:', { subId, transId, reward, status });
        
        if (status !== '1' || !subId || !reward) {
            return res.json({ success: false, error: 'Invalid status or missing fields' });
        }
        
        const rewardAmount = parseFloat(reward);
        const coinsToAdd = Math.round(rewardAmount * USD_TO_COINS);
        
        const { data: user, error: userError } = await supabase
            .from('users').select('coins, total_earned').eq('uid', subId).single();
            
        if (userError || !user) return res.status(404).json({ success: false, error: 'User not found' });
        
        await supabase.from('users').update({
            coins: (user.coins || 0) + coinsToAdd,
            total_earned: (user.total_earned || 0) + rewardAmount
        }).eq('uid', subId);
        
        await supabase.from('transactions').insert({
            user_id: subId, type: 'offerwall_reward',
            amount: rewardAmount, coins: coinsToAdd, currency: 'USD',
            description: `BitcoTasks: ${offer_name || offer_type || 'Offer'}`,
            status: 'completed', reference_id: transId,
            created_at: new Date().toISOString()
        });
        
        res.send('ok');
    } catch (error) {
        console.error('BitcoTasks postback error:', error);
        res.status(500).send('error');
    }
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 GNEXEN REWARD Backend`);
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🔑 Supabase connected`);
    console.log(`🪙 Coin System: 1 USD = ${USD_TO_COINS} Coins`);
    console.log(`✅ Server ready!`);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});
