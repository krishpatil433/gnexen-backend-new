// ============================================================
// GNEXEN REWARD - BACKEND
// Supabase + FaucetPay Automatic Payments + Faucet System
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
const supabaseUrl = process.env.SUPABASE_URL || 'https://ogkavpsfbihxbodvzppj.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_W4JV0K8shyAgOE0BUG6WPw_teElLVsE';
const supabase = createClient(supabaseUrl, supabaseKey);

// Coin System: 1 USD = 10,000 Coins
const USD_TO_COINS = 10000;

app.use(cors());
app.use(express.json());

// ============================================================
// 1. HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'GNEXEN Backend', 
        timestamp: new Date().toISOString() 
    });
});

// ============================================================
// 2. REGISTER
// ============================================================
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, referral } = req.body;
        
        // Check if user already exists
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

        // Create user in Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: { 
                data: { 
                    name: name,
                    coins: 0
                } 
            }
        });
        
        if (error) throw error;
        
        const user = data.user;
        const refCode = 'GNX' + Math.random().toString(36).substring(2, 8).toUpperCase();
        
        // Save user to database with coins
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

        // Create welcome transaction
        await supabase.from('transactions').insert({
            user_id: user.id,
            type: 'welcome_bonus',
            amount: 0,
            coins: 0,
            currency: 'USDT',
            description: 'Welcome to GNEXEN REWARD!',
            status: 'completed',
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

// ============================================================
// 3. LOGIN
// ============================================================
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

// ============================================================
// 4. GET USER DATA
// ============================================================
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
        
        res.json({ 
            success: true, 
            user: user 
        });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 5. UPDATE USER
// ============================================================
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
        
        res.json({ 
            success: true, 
            user: data[0] 
        });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 6. CREATE WITHDRAWAL
// ============================================================
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, method, account, amount, giftValue } = req.body;
        
        // Check user and coins
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
        
        // Create withdrawal
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
        
        // Deduct coins
        await supabase
            .from('users')
            .update({
                coins: user.coins - requiredCoins,
                total_withdrawn: (user.total_withdrawn || 0) + amount
            })
            .eq('uid', userId);
            
        // Create transaction
        await supabase.from('transactions').insert({
            user_id: userId,
            type: 'withdrawal_request',
            amount: amount,
            coins: requiredCoins,
            currency: method === 'faucetpay' ? 'USDT' : 'INR',
            description: `Withdrawal request via ${method}`,
            status: 'pending',
            reference_id: withdrawal.id,
            created_at: new Date().toISOString()
        });
        
        // If FaucetPay, process automatically
        if (method === 'faucetpay') {
            processFaucetPayment(withdrawal.id, userId, account, amount);
        }
        
        res.json({ 
            success: true, 
            withdrawal: withdrawal 
        });
        
    } catch (error) {
        console.error('Withdrawal error:', error);
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 7. PROCESS FAUCETPAY PAYMENT (AUTOMATIC)
// ============================================================
async function processFaucetPayment(withdrawalId, userId, account, amount) {
    console.log(`💰 Processing FaucetPay payment #${withdrawalId}`);
    
    try {
        // Get FaucetPay settings
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
                .update({
                    status: 'failed',
                    error: 'FaucetPay API Key not configured'
                })
                .eq('id', withdrawalId);
            return;
        }
        
        // Update status to processing
        await supabase
            .from('withdrawals')
            .update({
                status: 'processing',
                processed_at: new Date().toISOString()
            })
            .eq('id', withdrawalId);
            
        // Call FaucetPay API
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
        
        console.log('📥 FaucetPay Response:', response.data);
        
        if (response.data && response.data.status === 'success') {
            // Payment successful
            await supabase
                .from('withdrawals')
                .update({
                    status: 'paid',
                    transaction_id: response.data.txn_id || 'fp_' + Date.now(),
                    paid_at: new Date().toISOString()
                })
                .eq('id', withdrawalId);
                
            // Update transaction
            await supabase
                .from('transactions')
                .update({
                    status: 'completed',
                    transaction_id: response.data.txn_id || 'fp_' + Date.now()
                })
                .eq('reference_id', withdrawalId);
                
            console.log(`✅ Payment successful #${withdrawalId}`);
            
        } else {
            // Payment failed
            const errorMsg = response.data?.message || 'Unknown error';
            console.error('❌ FaucetPay failed:', errorMsg);
            
            await supabase
                .from('withdrawals')
                .update({
                    status: 'failed',
                    error: errorMsg
                })
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
        
    } catch (error) {
        console.error('❌ Payment error:', error);
        
        await supabase
            .from('withdrawals')
            .update({
                status: 'failed',
                error: error.message
            })
            .eq('id', withdrawalId);
            
        // Refund coins
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

// ============================================================
// 8. GET WITHDRAWALS
// ============================================================
app.get('/api/withdrawals/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const { data: withdrawals, error } = await supabase
            .from('withdrawals')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({ 
            success: true, 
            withdrawals: withdrawals 
        });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 9. GET PTC ADS
// ============================================================
app.get('/api/ptc-ads', async (req, res) => {
    try {
        const { data: ptcAds, error } = await supabase
            .from('ptc_ads')
            .select('*')
            .eq('status', 'active');
            
        if (error) throw error;
        
        res.json({ 
            success: true, 
            ptcAds: ptcAds 
        });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 10. GET TASKS
// ============================================================
app.get('/api/tasks', async (req, res) => {
    try {
        const { data: tasks, error } = await supabase
            .from('tasks')
            .select('*')
            .eq('status', 'active');
            
        if (error) throw error;
        
        res.json({ 
            success: true, 
            tasks: tasks 
        });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 11. COMPLETE TASK (AUTO VERIFY)
// ============================================================
app.post('/api/complete-task', async (req, res) => {
    try {
        const { userId, taskId, reward } = req.body;
        
        console.log('📝 Complete Task Request:', { userId, taskId, reward });
        
        // Validate
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'User ID required'
            });
        }
        
        if (!taskId) {
            return res.status(400).json({
                success: false,
                error: 'Task ID required'
            });
        }
        
        // Get user
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('coins, total_earned, completed_tasks')
            .eq('uid', userId)
            .single();
            
        if (userError || !user) {
            console.log('❌ User not found:', userId);
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const coinsToAdd = Math.round(reward * USD_TO_COINS);
        
        // Update user with coins
        const { error: updateError } = await supabase
            .from('users')
            .update({
                coins: (user.coins || 0) + coinsToAdd,
                total_earned: (user.total_earned || 0) + reward,
                completed_tasks: (user.completed_tasks || 0) + 1
            })
            .eq('uid', userId);
            
        if (updateError) {
            console.log('❌ Update error:', updateError);
            return res.status(400).json({
                success: false,
                error: updateError.message
            });
        }
        
        // Create transaction record with coins
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
        
        // Get updated user data
        const { data: updatedUser } = await supabase
            .from('users')
            .select('*')
            .eq('uid', userId)
            .single();
        
        console.log(`✅ Task completed! User ${userId} earned ${coinsToAdd} coins`);
        
        res.json({
            success: true,
            message: 'Task completed!',
            coins: coinsToAdd,
            newBalance: updatedUser?.coins || 0
        });
        
    } catch (error) {
        console.error('❌ Complete task error:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 12. FAUCET CLAIM (1 Coin Every 5 Minutes)
// ============================================================
app.post('/api/faucet-claim', async (req, res) => {
    try {
        const { userId, coins } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'User ID required'
            });
        }
        
        // Check last claim (5 minutes cooldown)
        const { data: lastClaim, error: lastError } = await supabase
            .from('faucet_history')
            .select('created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1);
            
        if (lastClaim && lastClaim.length > 0) {
            const lastTime = new Date(lastClaim[0].created_at).getTime();
            const now = Date.now();
            const diff = (now - lastTime) / 1000;
            
            if (diff < 300) {
                return res.status(400).json({
                    success: false,
                    error: `Please wait ${Math.ceil(300 - diff)} seconds`,
                    remaining: Math.ceil(300 - diff)
                });
            }
        }
        
        // Get user
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('coins, total_earned')
            .eq('uid', userId)
            .single();
            
        if (userError || !user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const coinAmount = coins || 1;
        
        // Add coins
        await supabase
            .from('users')
            .update({
                coins: (user.coins || 0) + coinAmount,
                total_earned: (user.total_earned || 0) + (coinAmount / USD_TO_COINS)
            })
            .eq('uid', userId);
            
        // Record faucet history
        await supabase
            .from('faucet_history')
            .insert({
                user_id: userId,
                coins: coinAmount,
                status: 'completed',
                created_at: new Date().toISOString()
            });
            
        // Create transaction
        await supabase.from('transactions').insert({
            user_id: userId,
            type: 'faucet_reward',
            amount: coinAmount / USD_TO_COINS,
            coins: coinAmount,
            currency: 'USDT',
            description: 'Faucet claim: 1 coin',
            status: 'completed',
            created_at: new Date().toISOString()
        });
            
        res.json({
            success: true,
            message: 'Faucet claimed successfully',
            coins: coinAmount
        });
        
    } catch (error) {
        console.error('Faucet claim error:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 13. GET FAUCET HISTORY
// ============================================================
app.get('/api/faucet-history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const { data: history, error } = await supabase
            .from('faucet_history')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);
            
        if (error) throw error;
        
        res.json({
            success: true,
            history: history || []
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 14. CHECK FAUCET STATUS (For Timer)
// ============================================================
app.get('/api/faucet-status/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const { data: lastClaim } = await supabase
            .from('faucet_history')
            .select('created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1);
            
        let remaining = 0;
        let canClaim = true;
        
        if (lastClaim && lastClaim.length > 0) {
            const lastTime = new Date(lastClaim[0].created_at).getTime();
            const now = Date.now();
            const diff = (now - lastTime) / 1000;
            
            if (diff < 300) {
                canClaim = false;
                remaining = Math.ceil(300 - diff);
            }
        }
        
        res.json({
            success: true,
            canClaim: canClaim,
            remaining: remaining
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 15. ADMIN - GET ALL USERS
// ============================================================
app.get('/api/admin/users', async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({
            success: true,
            users: users
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 16. ADMIN - GET ALL WITHDRAWALS
// ============================================================
app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        const { data: withdrawals, error } = await supabase
            .from('withdrawals')
            .select('*, users(name, email)')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({
            success: true,
            withdrawals: withdrawals
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 17. ADMIN - UPDATE WITHDRAWAL STATUS
// ============================================================
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
        
        res.json({
            success: true,
            withdrawal: data[0]
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 18. ADMIN - GET ALL PTC ADS
// ============================================================
app.get('/api/admin/ptc-ads', async (req, res) => {
    try {
        const { data: ptcAds, error } = await supabase
            .from('ptc_ads')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({
            success: true,
            ptcAds: ptcAds
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 19. ADMIN - CREATE PTC AD
// ============================================================
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
        
        res.json({
            success: true,
            ptcAd: data
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 20. ADMIN - UPDATE PTC AD
// ============================================================
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
        
        res.json({
            success: true,
            ptcAd: data[0]
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 21. ADMIN - DELETE PTC AD
// ============================================================
app.delete('/api/admin/ptc-ad/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const { error } = await supabase
            .from('ptc_ads')
            .delete()
            .eq('id', id);
            
        if (error) throw error;
        
        res.json({
            success: true,
            message: 'PTC Ad deleted successfully'
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 22. ADMIN - GET ALL TASKS
// ============================================================
app.get('/api/admin/tasks', async (req, res) => {
    try {
        const { data: tasks, error } = await supabase
            .from('tasks')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({
            success: true,
            tasks: tasks
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 23. ADMIN - CREATE TASK
// ============================================================
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
        
        res.json({
            success: true,
            task: data
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 24. ADMIN - UPDATE TASK
// ============================================================
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
        
        res.json({
            success: true,
            task: data[0]
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 25. ADMIN - DELETE TASK
// ============================================================
app.delete('/api/admin/task/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const { error } = await supabase
            .from('tasks')
            .delete()
            .eq('id', id);
            
        if (error) throw error;
        
        res.json({
            success: true,
            message: 'Task deleted successfully'
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 26. GET SETTINGS (Public)
// ============================================================
app.get('/api/settings/:key', async (req, res) => {
    try {
        const { key } = req.params;
        
        const { data: settings, error } = await supabase
            .from('settings')
            .select('value')
            .eq('key', key)
            .single();
            
        if (error) throw error;
        
        res.json({
            success: true,
            settings: settings?.value || {}
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 27. ADMIN - UPDATE SETTINGS
// ============================================================
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
            // If not exists, insert
            const { data: insertData, error: insertError } = await supabase
                .from('settings')
                .insert({
                    key: key,
                    value: value,
                    updated_at: new Date().toISOString()
                })
                .select();
                
            if (insertError) throw insertError;
            
            return res.json({
                success: true,
                settings: insertData[0]
            });
        }
        
        res.json({
            success: true,
            settings: data[0]
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 28. START SERVER
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 GNEXEN REWARD Backend`);
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🔑 Supabase connected: ${supabaseUrl}`);
    console.log(`🪙 Coin System: 1 USD = ${USD_TO_COINS} Coins`);
    console.log(`💰 Faucet: 1 Coin every 5 minutes`);
    console.log(`⚡ FaucetPay: AUTO`);
    console.log(`✅ Server ready!`);
});

// ============================================================
// ERROR HANDLING
// ============================================================
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});
