// ============================================================
// GNEXEN REWARD - BACKEND (Without Faucet)
// User Panel + Admin Panel + Tasks + Withdrawals
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// SUPABASE CONFIG
// ============================================================
const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'your-anon-key';
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
// 2. REGISTER USER
// ============================================================
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, referral } = req.body;
        
        // Check if user exists
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
                data: { name: name }
            }
        });
        
        if (error) throw error;
        
        const user = data.user;
        const refCode = 'GNX' + Math.random().toString(36).substring(2, 8).toUpperCase();
        
        // Save user to database
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

// ============================================================
// 3. LOGIN USER
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
        
        res.json({ success: true, user });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 5. UPDATE USER PROFILE
// ============================================================
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
// 6. GET ALL TASKS (User Panel)
// ============================================================
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

// ============================================================
// 7. COMPLETE TASK
// ============================================================
app.post('/api/complete-task', async (req, res) => {
    try {
        const { userId, taskId, reward } = req.body;
        
        if (!userId || !taskId) {
            return res.status(400).json({
                success: false,
                error: 'User ID and Task ID required'
            });
        }
        
        // Get user
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
        
        // Update user
        await supabase
            .from('users')
            .update({
                coins: (user.coins || 0) + coinsToAdd,
                total_earned: (user.total_earned || 0) + reward,
                completed_tasks: (user.completed_tasks || 0) + 1
            })
            .eq('uid', userId);
        
        // Create transaction
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
// 8. GET PTC ADS
// ============================================================
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
// 9. CREATE WITHDRAWAL REQUEST
// ============================================================
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, method, account, amount, giftValue } = req.body;
        
        // Check user
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

// ============================================================
// 10. GET USER WITHDRAWALS
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
        
        res.json({ success: true, withdrawals });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 11. GET USER TRANSACTIONS
// ============================================================
app.get('/api/transactions/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const { data: transactions, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({ success: true, transactions });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 12. GET REFERRAL STATS
// ============================================================
app.get('/api/referral/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const { data: referrals, error } = await supabase
            .from('users')
            .select('uid, name, email, created_at')
            .eq('referred_by', userId);
            
        if (error) throw error;
        
        const { data: user } = await supabase
            .from('users')
            .select('referral_code, referral_earnings')
            .eq('uid', userId)
            .single();
            
        res.json({
            success: true,
            referralCode: user?.referral_code,
            referralEarnings: user?.referral_earnings || 0,
            totalReferrals: referrals?.length || 0,
            referrals: referrals || []
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 13. GET LEADERBOARD
// ============================================================
app.get('/api/leaderboard', async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('name, coins, total_earned, completed_tasks')
            .order('coins', { ascending: false })
            .limit(10);
            
        if (error) throw error;
        
        res.json({ success: true, leaderboard: users });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 14. ADMIN - GET ALL USERS
// ============================================================
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
// 15. ADMIN - GET ALL WITHDRAWALS
// ============================================================
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

// ============================================================
// 16. ADMIN - UPDATE WITHDRAWAL STATUS
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
        
        res.json({ success: true, withdrawal: data[0] });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 17. ADMIN - CREATE TASK
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
        
        res.json({ success: true, task: data });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 18. ADMIN - UPDATE TASK
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
        
        res.json({ success: true, task: data[0] });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 19. ADMIN - DELETE TASK
// ============================================================
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

// ============================================================
// 20. ADMIN - GET ALL TASKS
// ============================================================
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
// 21. ADMIN - CREATE PTC AD
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
        
        res.json({ success: true, ptcAd: data });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 22. ADMIN - GET ALL PTC ADS
// ============================================================
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
// 23. ADMIN - UPDATE PTC AD
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
        
        res.json({ success: true, ptcAd: data[0] });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 24. ADMIN - DELETE PTC AD
// ============================================================
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
// 25. ADMIN - UPDATE SETTINGS
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
        
        res.json({ success: true, settings: settings?.value || {} });
        
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
    console.log(`✅ Server ready!`);
});

// Error Handling
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});
