// ============================================================
// GNEXEN REWARD - COMPLETE BACKEND (With FaucetPay)
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Config
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const USD_TO_COINS = 10000;
const FAUCETPAY_API_URL = 'https://faucetpay.io/api/v1';

app.use(cors());
app.use(express.json());

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'GNEXEN Backend', timestamp: new Date().toISOString() });
});

// ============================================================
// USER APIs (Registration, Login, etc.)
// ============================================================

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, referral } = req.body;
        
        const { data: existingUser } = await supabase
            .from('users')
            .select('email')
            .eq('email', email)
            .single();

        if (existingUser) {
            return res.status(400).json({ success: false, error: 'Email already registered' });
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

        res.json({ success: true, user: { id: user.id, name, email, referralCode: refCode, coins: 0 } });
        
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

// Get User
app.get('/api/user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('uid', uid)
            .single();
            
        if (error) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        res.json({ success: true, user });
        
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
            .update({ name: name, updated_at: new Date().toISOString() })
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

// Get Tasks
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

// Complete Task
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
        
        await supabase
            .from('users')
            .update({
                coins: (user.coins || 0) + coinsToAdd,
                total_earned: (user.total_earned || 0) + reward,
                completed_tasks: (user.completed_tasks || 0) + 1
            })
            .eq('uid', userId);
        
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
            .from('users')
            .select('*')
            .eq('uid', userId)
            .single();
        
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

// ============================================================
// PTC ADS APIs
// ============================================================

// Get PTC Ads
app.get('/api/ptc-ads', async (req, res) => {
    try {
        const { data: ptcAds, error } = await supabase
            .from('ptc_ads')
            .select('*')
            .eq('status', 'active');
            
        if (error) throw error;
        
        res.json({ success: true, ptcAds });
        
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============================================================
// WITHDRAWAL APIs
// ============================================================

// Create Withdrawal Request
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, method, account, amount, giftValue } = req.body;
        
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('coins, balance')
            .eq('uid', userId)
            .single();
            
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
        
        const { data: withdrawal, error } = await supabase
            .from('withdrawals')
            .insert({
                user_id: userId,
                method: method,
                account: account,
                amount: amount,
                coins_deducted: requiredCoins,
                gift_value: giftValue || null,
                status: 'pending',
                created_at: new Date().toISOString()
            })
            .select()
            .single();
            
        if (error) throw error;
        
        await supabase
            .from('users')
            .update({
                coins: user.coins - requiredCoins,
                total_withdrawn: (user.total_withdrawn || 0) + amount
            })
            .eq('uid', userId);
        
        // If FaucetPay, process automatically
        if (method === 'faucetpay') {
            processFaucetPayment(withdrawal.id, userId, account, amount);
        }
        
        res.json({ success: true, withdrawal: withdrawal });
        
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Process FaucetPay Payment (Automatic)
async function processFaucetPayment(withdrawalId, userId, account, amount) {
    console.log(`💰 Processing FaucetPay payment #${withdrawalId}`);
    
    try {
        const { data: settings } = await supabase
            .from('settings')
            .select('value')
            .eq('key', 'faucetpay')
            .single();
            
        const config = settings?.value || {};
        
        if (!config.api_key) {
            console.error('❌ FaucetPay API Key not configured');
            await supabase
                .from('withdrawals')
                .update({ status: 'failed', error: 'FaucetPay API Key not configured' })
                .eq('id', withdrawalId);
            return;
        }
        
        await supabase
            .from('withdrawals')
            .update({ status: 'processing', processed_at: new Date().toISOString() })
            .eq('id', withdrawalId);
        
        const response = await axios.post(`${FAUCETPAY_API_URL}/send`, null, {
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
        
        console.log('📥 FaucetPay Response:', response.data);
        
        if (response.data && response.data.status === 'success') {
            await supabase
                .from('withdrawals')
                .update({
                    status: 'paid',
                    transaction_id: response.data.txn_id || 'fp_' + Date.now(),
                    paid_at: new Date().toISOString()
                })
                .eq('id', withdrawalId);
                
            await supabase
                .from('transactions')
                .update({
                    status: 'completed',
                    transaction_id: response.data.txn_id || 'fp_' + Date.now()
                })
                .eq('reference_id', withdrawalId);
                
            console.log(`✅ Payment successful #${withdrawalId}`);
        } else {
            throw new Error(response.data?.message || 'Unknown error');
        }
        
    } catch (error) {
        console.error('❌ Payment error:', error);
        await supabase
            .from('withdrawals')
            .update({ status: 'failed', error: error.message })
            .eq('id', withdrawalId);
        
        // Refund coins to user
        const wDoc = await supabase
            .from('withdrawals')
            .select('coins_deducted, user_id')
            .eq('id', withdrawalId)
            .single();
            
        if (wDoc.data) {
            const { data: user } = await supabase
                .from('users')
                .select('coins')
                .eq('uid', wDoc.data.user_id)
                .single();
                
            if (user) {
                await supabase
                    .from('users')
                    .update({
                        coins: (user.coins || 0) + (wDoc.data.coins_deducted || 0)
                    })
                    .eq('uid', wDoc.data.user_id);
            }
        }
    }
}

// Get User Withdrawals
app.get('/api/withdrawals/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const { data: withdrawals, error } = await supabase
            .from('withdrawals')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({ success: true, withdrawals });
        
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============================================================
// FAUCETPAY APIs (Direct)
// ============================================================

// Process FaucetPay Payment (Called from Admin)
app.post('/api/process-faucetpay', async (req, res) => {
    try {
        const { withdrawalId, userId, account, amount } = req.body;
        
        if (!withdrawalId || !account || !amount) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        const { data: settings } = await supabase
            .from('settings')
            .select('value')
            .eq('key', 'faucetpay')
            .single();
            
        if (!settings?.value?.api_key) {
            return res.status(400).json({ success: false, error: 'FaucetPay API key not configured' });
        }
        
        const config = settings.value;
        
        const response = await axios.post(`${FAUCETPAY_API_URL}/send`, null, {
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
                .update({
                    status: 'paid',
                    transaction_id: response.data.txn_id || 'fp_' + Date.now(),
                    paid_at: new Date().toISOString()
                })
                .eq('id', withdrawalId);
                
            res.json({
                success: true,
                message: 'Payment sent successfully',
                transaction_id: response.data.txn_id
            });
        } else {
            throw new Error(response.data?.message || 'Payment failed');
        }
        
    } catch (error) {
        console.error('FaucetPay error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Check FaucetPay Balance
app.get('/api/faucetpay-balance', async (req, res) => {
    try {
        const { data: settings } = await supabase
            .from('settings')
            .select('value')
            .eq('key', 'faucetpay')
            .single();
            
        if (!settings?.value?.api_key) {
            return res.status(400).json({ success: false, error: 'FaucetPay API key not configured' });
        }
        
        const response = await axios.get(`${FAUCETPAY_API_URL}/balance`, {
            params: { api_key: settings.value.api_key }
        });
        
        res.json({
            success: true,
            balance: response.data
        });
        
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============================================================
// ADMIN APIs
// ============================================================

// Get All Users
app.get('/api/admin/users', async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({ success: true, users });
        
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Get All Withdrawals
app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        const { data: withdrawals, error } = await supabase
            .from('withdrawals')
            .select('*, users(name, email)')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({ success: true, withdrawals });
        
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Update Withdrawal Status
app.put('/api/admin/withdrawal/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, giftCardCode } = req.body;
        
        const updateData = {
            status: status,
            processed_at: new Date().toISOString()
        };
        
        if (giftCardCode) {
            updateData.gift_card_code = giftCardCode;
        }
        
        if (status === 'paid') {
            updateData.paid_at = new Date().toISOString();
        }
        
        const { data, error } = await supabase
            .from('withdrawals')
            .update(updateData)
            .eq('id', id)
            .select();
            
        if (error) throw error;
        
        // If rejected, refund coins
        if (status === 'rejected') {
            const wDoc = await supabase
                .from('withdrawals')
                .select('coins_deducted, user_id')
                .eq('id', id)
                .single();
                
            if (wDoc.data && wDoc.data.coins_deducted) {
                const { data: user } = await supabase
                    .from('users')
                    .select('coins')
                    .eq('uid', wDoc.data.user_id)
                    .single();
                    
                if (user) {
                    await supabase
                        .from('users')
                        .update({
                            coins: (user.coins || 0) + (wDoc.data.coins_deducted || 0)
                        })
                        .eq('uid', wDoc.data.user_id);
                }
            }
        }
        
        res.json({ success: true, withdrawal: data[0] });
        
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Update Settings
app.put('/api/admin/settings/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const { value } = req.body;
        
        const { data, error } = await supabase
            .from('settings')
            .update({
                value: value,
                updated_at: new Date().toISOString()
            })
            .eq('key', key)
            .select();
            
        if (error) {
            const { data: insertData, error: insertError } = await supabase
                .from('settings')
                .insert({
                    key: key,
                    value: value,
                    updated_at: new Date().toISOString()
                })
                .select();
                
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
    console.log(`🪙 Coin System: 1 USD = ${USD_TO_COINS} Coins`);
    console.log(`💰 FaucetPay: AUTO`);
    console.log(`✅ Server ready!`);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});
