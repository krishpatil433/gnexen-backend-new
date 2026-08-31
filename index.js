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
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 5. ADMIN - UPDATE USER STATUS
app.put('/api/admin/user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const { status } = req.body;
        
        const { data, error } = await supabase
            .from('users')
            .update({ 
                status: status,
                updated_at: new Date().toISOString()
            })
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

// 6. GET ALL TASKS
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

// 7. COMPLETE TASK
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

// 8. ADMIN - CREATE TASK
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

// 9. ADMIN - UPDATE TASK
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

// 10. ADMIN - DELETE TASK
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

// 11. ADMIN - GET ALL TASKS
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

// ============================================================
// PTC ADS APIs
// ============================================================

// 12. GET PTC ADS
app.get('/api/ptc-ads', async (req, res) => {
    try {
        const { data: ptcAds, error } = await supabase
            .from('ptc_ads')
            .select('*')
            .eq('status', 'active')
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

// 13. ADMIN - CREATE PTC AD
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

// 14. ADMIN - UPDATE PTC AD
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

// 15. ADMIN - DELETE PTC AD
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

// 16. ADMIN - GET ALL PTC ADS
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

// ============================================================
// SHORTLINK APIs
// ============================================================

// 17. GET SHORTLINKS (Public)
app.get('/api/shortlinks', async (req, res) => {
    try {
        const { data: shortlinks, error } = await supabase
            .from('shortlinks')
            .select('*')
            .eq('status', 'active')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({ success: true, shortlinks });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 18. GET SHORTLINK BY ID (For visit tracking)
app.get('/api/shortlink/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const { data: shortlink, error } = await supabase
            .from('shortlinks')
            .select('*')
            .eq('id', id)
            .single();
            
        if (error) {
            return res.status(404).json({
                success: false,
                error: 'Shortlink not found'
            });
        }
        
        // Increment clicks (async - don't wait)
        supabase
            .from('shortlinks')
            .update({
                total_clicks: (shortlink.total_clicks || 0) + 1,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .then(() => {})
            .catch(() => {});
        
        res.json({ 
            success: true, 
            url: shortlink.shortlink_url,
            reward: shortlink.reward
        });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 19. ADMIN - CREATE SHORTLINK
app.post('/api/admin/shortlink', async (req, res) => {
    try {
        const { 
            title, 
            provider, 
            shortlink_url, 
            api_key, 
            reward, 
            daily_limit, 
            total_limit, 
            status 
        } = req.body;
        
        const { data, error } = await supabase
            .from('shortlinks')
            .insert({
                title: title,
                provider: provider || 'custom',
                shortlink_url: shortlink_url,
                api_key: api_key || '',
                reward: reward,
                daily_limit: daily_limit || 0,
                total_limit: total_limit || 0,
                total_clicks: 0,
                status: status || 'active',
                created_at: new Date().toISOString()
            })
            .select()
            .single();
            
        if (error) throw error;
        
        res.json({ success: true, shortlink: data });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// 20. ADMIN - UPDATE SHORTLINK
app.put('/api/admin/shortlink/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            title, 
            provider, 
            shortlink_url, 
            api_key, 
            reward, 
            daily_limit, 
            total_limit, 
            status 
        } = req.body;
        
        const { data, error } = await supabase
            .from('shortlinks')
            .update({
                title: title,
                provider: provider || 'custom',
                shortlink_url: shortlink_url,
                api_key: api_key || '',
                reward: reward,
                daily_limit: daily_limit || 0,
                total_limit: total_limit || 0,
                status: status || 'active',
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select();
            
        if (error) throw error;
        
        res.json({ success: true, shortlink: data[0] });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// 21. ADMIN - DELETE SHORTLINK
app.delete('/api/admin/shortlink/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const { error } = await supabase
            .from('shortlinks')
            .delete()
            .eq('id', id);
            
        if (error) throw error;
        
        res.json({ success: true, message: 'Shortlink deleted successfully' });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// 22. ADMIN - GET ALL SHORTLINKS
app.get('/api/admin/shortlinks', async (req, res) => {
    try {
        const { data: shortlinks, error } = await supabase
            .from('shortlinks')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({ success: true, shortlinks });
        
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

// 23. CREATE WITHDRAWAL REQUEST
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

// 24. GET USER WITHDRAWALS
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

// 25. ADMIN - GET ALL WITHDRAWALS
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

// 26. ADMIN - UPDATE WITHDRAWAL STATUS
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

// ============================================================
// ADMIN - GET ALL USERS
// ============================================================

// 27. ADMIN - GET ALL USERS
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

// ============================================================
// FAUCET APIs
// ============================================================

// 28. FAUCET CLAIM
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
        
        await supabase
            .from('users')
            .update({
                coins: (user.coins || 0) + coinAmount,
                total_earned: (user.total_earned || 0) + (coinAmount / USD_TO_COINS)
            })
            .eq('uid', userId);
            
        await supabase
            .from('faucet_history')
            .insert({
                user_id: userId,
                coins: coinAmount,
                status: 'completed',
                created_at: new Date().toISOString()
            });
        
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

// 29. GET FAUCET HISTORY
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

// 30. CHECK FAUCET STATUS
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
// FAUCETPAY APIs
// ============================================================

// 31. PROCESS FAUCETPAY PAYMENT
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

// 32. PROCESS FAUCETPAY (Manual - Admin)
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

// 33. CHECK FAUCETPAY BALANCE
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
// SETTINGS APIs
// ============================================================

// 34. GET SETTINGS
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

// 35. ADMIN - UPDATE SETTINGS
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

// ============================================================
// OFFERWALL POSTBACK (c.cx.ua)
// ============================================================

// 36. OFFERWALL POSTBACK
app.post('/api/offerwall-webhook', async (req, res) => {
    try {
        const { subId, transId, offer_name, offer_type, payout, status } = req.body;
        
        console.log('📥 Offerwall Postback:', { subId, transId, offer_name, offer_type, payout, status });
        
        if (status === '1' && subId && payout) {
            const coinsToAdd = Math.round(parseFloat(payout) * USD_TO_COINS);
            
            const { data: user, error: userError } = await supabase
                .from('users')
                .select('coins, total_earned')
                .eq('uid', subId)
                .single();
                
            if (userError || !user) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            
            await supabase
                .from('users')
                .update({
                    coins: (user.coins || 0) + coinsToAdd,
                    total_earned: (user.total_earned || 0) + parseFloat(payout)
                })
                .eq('uid', subId);
            
            await supabase.from('transactions').insert({
                user_id: subId,
                type: 'offerwall_reward',
                amount: parseFloat(payout),
                coins: coinsToAdd,
                currency: 'USD',
                description: `Offerwall: ${offer_name || offer_type || 'Offer'}`,
                status: 'completed',
                reference_id: transId,
                created_at: new Date().toISOString()
            });
            
            console.log(`✅ Offerwall reward added to user ${subId}: ${coinsToAdd} coins`);
            res.json({ success: true, message: 'Reward processed' });
        } else {
            console.log('⚠️ Offerwall postback status not success:', status);
            res.json({ success: false, error: 'Invalid status' });
        }
    } catch (error) {
        console.error('❌ Offerwall postback error:', error);
        res.status(500).json({ success: false, error: error.message });
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
    console.log(`📢 Offerwall: ACTIVE`);
    console.log(`✅ Server ready!`);
});

// Error Handling
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});
