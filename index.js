// ============================================================
// GNEXEN REWARD - COMPLETE BACKEND
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

// Coin System: 1 USD = 10,000 Coins
const USD_TO_COINS = 10000;
const FAUCETPAY_API_URL = 'https://faucetpay.io/api/v1';

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
            options: { 
                data: { name: name }
            }
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
            user: { 
                id: user.id, 
                name, 
                email, 
                referralCode: refCode,
                coins: 0
            } 
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
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
            return res.status(404).json({
                success: false,
                error: 'User profile not found'
            });
        }
        
        res.json({ 
            success: true, 
            user: userProfile, 
            session: data.session 
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 3. GET USER DATA
app.get('/api/user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('uid', uid)
            .single();
            
        if (error) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        res.json({ success: true, user });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 4. UPDATE USER
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
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// TASK APIs
// ============================================================

// 5. GET ALL TASKS
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
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 6. COMPLETE TASK
app.post('/api/complete-task', async (req, res) => {
    try {
        const { userId, taskId, reward } = req.body;
        
        if (!userId || !taskId) {
            return res.status(400).json({
                success: false,
                error: 'User ID and Task ID required'
            });
        }
        
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('coins, total_earned, completed_tasks')
            .eq('uid', userId)
            .single();
            
        if (userError || !user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
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
        console.error('Complete task error:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// PTC ADS APIs
// ============================================================

// 7. GET PTC ADS
app.get('/api/ptc-ads', async (req, res) => {
    try {
        const { data: ptcAds, error } = await supabase
            .from('ptc_ads')
            .select('*')
            .eq('status', 'active');
            
        if (error) throw error;
        
        res.json({ success: true, ptcAds });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// WITHDRAWAL APIs
// ============================================================

// 8. CREATE WITHDRAWAL REQUEST
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, method, account, amount, giftValue } = req.body;
        
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('coins, balance')
            .eq('uid', userId)
            .single();
            
        if (userError || !user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
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
        
        res.json({ 
            success: true, 
            withdrawal: withdrawal,
            message: 'Withdrawal request submitted successfully'
        });
        
    } catch (error) {
        console.error('Withdrawal error:', error);
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 9. PROCESS FAUCETPAY PAYMENT (AUTOMATIC)
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

// 10. GET USER WITHDRAWALS
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
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// FAUCETPAY APIs (Direct)
// ============================================================

// 11. PROCESS FAUCETPAY PAYMENT (Called from Admin)
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

// 12. CHECK FAUCETPAY BALANCE
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
// BITCOTASKS OFFERWALL POSTBACK HANDLER
// ============================================================

// 13. GET - Test endpoint for BitcoTasks Webhook
app.get('/api/bitcotasks-webhook', (req, res) => {
    res.json({
        success: true,
        message: 'BitcoTasks Webhook is active and ready to receive POST requests',
        method: 'POST',
        endpoint: '/api/bitcotasks-webhook',
        usage: 'Send POST request with user_id, amount, transaction_id, status',
        example: {
            method: 'POST',
            url: 'https://gnexen-backend-new.onrender.com/api/bitcotasks-webhook',
            body: {
                user_id: 'user-uid-here',
                amount: '0.50',
                transaction_id: 'btc_12345',
                status: 'success'
            }
        },
        timestamp: new Date().toISOString()
    });
});

// 14. POST - BitcoTasks Webhook Handler
app.post('/api/bitcotasks-webhook', async (req, res) => {
    try {
        const { user_id, amount, transaction_id, status, signature } = req.body;
        
        console.log('📥 BitcoTasks Postback Received:', { user_id, amount, transaction_id, status });
        
        // Verify signature/secret (Optional but recommended)
        const secret = process.env.BITCOTASKS_SECRET;
        // if (secret && signature !== secret) {
        //     return res.status(401).json({ success: false, error: 'Invalid signature' });
        // }
        
        if (!user_id || !amount) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields: user_id and amount' 
            });
        }
        
        if (status === 'success') {
            // Convert amount to coins (1 USD = 10000 coins)
            const coinsToAdd = Math.round(parseFloat(amount) * USD_TO_COINS);
            
            // Get user
            const { data: user, error: userError } = await supabase
                .from('users')
                .select('coins, total_earned')
                .eq('uid', user_id)
                .single();
                
            if (userError || !user) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'User not found' 
                });
            }
            
            // Update user coins
            await supabase
                .from('users')
                .update({
                    coins: (user.coins || 0) + coinsToAdd,
                    total_earned: (user.total_earned || 0) + parseFloat(amount)
                })
                .eq('uid', user_id);
            
            // Create transaction record
            await supabase.from('transactions').insert({
                user_id: user_id,
                type: 'offerwall_reward',
                amount: parseFloat(amount),
                coins: coinsToAdd,
                currency: 'USD',
                description: `BitcoTasks Offerwall Reward (${transaction_id || 'N/A'})`,
                status: 'completed',
                reference_id: transaction_id || 'btc_' + Date.now(),
                created_at: new Date().toISOString()
            });
            
            console.log(`✅ BitcoTasks reward added to user ${user_id}: ${coinsToAdd} coins`);
            
            res.json({ 
                success: true, 
                message: 'Reward processed successfully',
                coins_added: coinsToAdd
            });
            
        } else {
            console.log('⚠️ BitcoTasks Postback status not success:', status);
            res.json({ 
                success: false, 
                error: 'Invalid status: ' + status 
            });
        }
        
    } catch (error) {
        console.error('❌ BitcoTasks Postback error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// ADMIN APIs
// ============================================================

// 15. ADMIN - GET ALL USERS
app.get('/api/admin/users', async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({ success: true, users });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// 16. ADMIN - GET ALL WITHDRAWALS
app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        const { data: withdrawals, error } = await supabase
            .from('withdrawals')
            .select('*, users(name, email)')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({ success: true, withdrawals });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// 17. ADMIN - UPDATE WITHDRAWAL STATUS
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
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// 18. ADMIN - UPDATE SETTINGS
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
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// 19. ADMIN - GET SETTINGS
app.get('/api/settings/:key', async (req, res) => {
    try {
        const { key } = req.params;
        
        const { data: settings, error } = await supabase
            .from('settings')
            .select('value')
            .eq('key', key)
            .single();
            
        if (error) throw error;
        
        res.json({ success: true, settings: settings?.value || {} });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// 20. ADMIN - CREATE TASK
app.post('/api/admin/task', async (req, res) => {
    try {
        const { title, description, category, taskUrl, instructions, reward, status } = req.body;
        
        const { data, error } = await supabase
            .from('tasks')
            .insert({
                title: title,
                description: description || '',
                category: category || 'general',
                task_url: taskUrl || '',
                instructions: instructions || '',
                reward: reward,
                status: status || 'active',
                created_at: new Date().toISOString()
            })
            .select()
            .single();
            
        if (error) throw error;
        
        res.json({ success: true, task: data });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// 21. ADMIN - UPDATE TASK
app.put('/api/admin/task/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, category, taskUrl, instructions, reward, status } = req.body;
        
        const { data, error } = await supabase
            .from('tasks')
            .update({
                title: title,
                description: description || '',
                category: category || 'general',
                task_url: taskUrl || '',
                instructions: instructions || '',
                reward: reward,
                status: status,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select();
            
        if (error) throw error;
        
        res.json({ success: true, task: data[0] });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// 22. ADMIN - DELETE TASK
app.delete('/api/admin/task/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const { error } = await supabase
            .from('tasks')
            .delete()
            .eq('id', id);
            
        if (error) throw error;
        
        res.json({ success: true, message: 'Task deleted successfully' });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// 23. ADMIN - GET ALL TASKS
app.get('/api/admin/tasks', async (req, res) => {
    try {
        const { data: tasks, error } = await supabase
            .from('tasks')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({ success: true, tasks });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// 24. ADMIN - CREATE PTC AD
app.post('/api/admin/ptc-ad', async (req, res) => {
    try {
        const { title, description, destinationUrl, viewDuration, reward, status } = req.body;
        
        const { data, error } = await supabase
            .from('ptc_ads')
            .insert({
                title: title,
                description: description || '',
                destination_url: destinationUrl,
                view_duration: viewDuration || 5,
                reward: reward,
                status: status || 'active',
                total_clicks: 0,
                created_at: new Date().toISOString()
            })
            .select()
            .single();
            
        if (error) throw error;
        
        res.json({ success: true, ptcAd: data });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// 25. ADMIN - GET ALL PTC ADS
app.get('/api/admin/ptc-ads', async (req, res) => {
    try {
        const { data: ptcAds, error } = await supabase
            .from('ptc_ads')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({ success: true, ptcAds });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// 26. ADMIN - UPDATE PTC AD
app.put('/api/admin/ptc-ad/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, destinationUrl, viewDuration, reward, status } = req.body;
        
        const { data, error } = await supabase
            .from('ptc_ads')
            .update({
                title: title,
                description: description || '',
                destination_url: destinationUrl,
                view_duration: viewDuration || 5,
                reward: reward,
                status: status,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select();
            
        if (error) throw error;
        
        res.json({ success: true, ptcAd: data[0] });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// 27. ADMIN - DELETE PTC AD
app.delete('/api/admin/ptc-ad/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const { error } = await supabase
            .from('ptc_ads')
            .delete()
            .eq('id', id);
            
        if (error) throw error;
        
        res.json({ success: true, message: 'PTC Ad deleted successfully' });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
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
    console.log(`📢 BitcoTasks Offerwall: ACTIVE`);
    console.log(`✅ Server ready!`);
});

// Error Handling
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});
