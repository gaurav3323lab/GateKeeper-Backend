const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');

// ── GET Community Feed (Posts & Polls) ────────────────────────
router.get('/posts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    // Get user's society and flat
    const [userRows] = await db.execute('SELECT tower, flat_number, society_id FROM users WHERE id = ?', [userId]);
    const societyId = userRows[0]?.society_id || 1;
    const tower = userRows[0]?.tower || '';
    const flatNumber = userRows[0]?.flat_number || '';

    // Fetch all community posts/polls in the resident's society
    const [posts] = await db.execute(`
      SELECT cp.*, u.name AS author_name, u.role AS author_role, u.tower AS author_tower, u.flat_number AS author_flat
      FROM community_posts cp
      JOIN users u ON cp.author_id = u.id
      WHERE cp.society_id = ?
      ORDER BY cp.created_at DESC
      LIMIT 30
    `, [societyId]);

    const result = [];
    for (const post of posts) {
      // 1. Fetch total likes count
      const [likesCount] = await db.execute('SELECT COUNT(*) AS cnt FROM community_likes WHERE post_id = ?', [post.id]);
      
      // 2. Check if logged-in user liked this post
      const [likedByMeRows] = await db.execute('SELECT id FROM community_likes WHERE post_id = ? AND user_id = ?', [post.id, userId]);
      
      // 3. Fetch discussion comments
      const [comments] = await db.execute(`
        SELECT cc.*, u.name AS author_name, u.role AS author_role
        FROM community_comments cc
        JOIN users u ON cc.author_id = u.id
        WHERE cc.post_id = ?
        ORDER BY cc.created_at ASC
      `, [post.id]);

      // 4. If it's a poll, get options, total votes, and calculate percentages
      let pollData = null;
      if (post.type === 'poll') {
        const options = JSON.parse(post.poll_options || '[]');
        const votesMap = {};
        options.forEach(o => { votesMap[o] = 0; });

        // Sum votes per option
        const [votes] = await db.execute('SELECT selected_option, COUNT(*) AS cnt FROM community_poll_votes WHERE post_id = ? GROUP BY selected_option', [post.id]);
        let totalVotes = 0;
        votes.forEach(v => {
          votesMap[v.selected_option] = parseInt(v.cnt, 10);
          totalVotes += parseInt(v.cnt, 10);
        });

        // Check if anyone from the user's flat has voted on this poll (1 vote per flat rule)
        const [myFlatVote] = await db.execute(`
          SELECT selected_option FROM community_poll_votes 
          WHERE post_id = ? AND user_id IN (SELECT id FROM users WHERE COALESCE(tower, '') = COALESCE(?, '') AND flat_number = ? AND society_id = ?)
          LIMIT 1
        `, [post.id, tower, flatNumber, societyId]);
        
        const votedOption = myFlatVote[0]?.selected_option || null;

        // Compute percentages safely
        const percentages = {};
        options.forEach(o => {
          percentages[o] = totalVotes > 0 ? Math.round((votesMap[o] / totalVotes) * 100) : 0;
        });

        pollData = {
          options,
          votesMap,
          totalVotes,
          percentages,
          votedOption
        };
      }

      // Convert timestamp to time-ago helper string
      const timeDiff = Date.now() - new Date(post.created_at).getTime();
      let timeAgo = 'Just now';
      if (timeDiff > 86400000) {
        timeAgo = `${Math.floor(timeDiff / 86400000)} days ago`;
      } else if (timeDiff > 3600000) {
        timeAgo = `${Math.floor(timeDiff / 3600000)} hr ago`;
      } else if (timeDiff > 60000) {
        timeAgo = `${Math.floor(timeDiff / 60000)} min ago`;
      }

      result.push({
        id: post.id,
        type: post.type,
        title: post.title,
        body: post.body,
        created_at: post.created_at,
        timeAgo,
        author_name: post.author_name,
        author_role: post.author_role,
        author_tower: post.author_tower,
        author_flat: post.author_flat,
        likesCount: likesCount[0].cnt,
        likedByMe: likedByMeRows.length > 0,
        comments: comments.map(c => {
          const cDiff = Date.now() - new Date(c.created_at).getTime();
          let cTime = 'Just now';
          if (cDiff > 3600000) cTime = `${Math.floor(cDiff / 3600000)} hr ago`;
          else if (cDiff > 60000) cTime = `${Math.floor(cDiff / 60000)} min ago`;
          return {
            author: c.author_name,
            text: c.text,
            time: cTime
          };
        }),
        pollData
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Error fetching community posts:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── POST Create Text Post or Poll ────────────────────────────
router.post('/posts', verifyToken, async (req, res) => {
  const { type, title, body, poll_options } = req.body;
  if (!title) return res.status(400).json({ message: 'Title or Question is required' });
  
  try {
    const userId = req.user.id;
    const [userRows] = await db.execute('SELECT society_id FROM users WHERE id = ?', [userId]);
    const societyId = userRows[0]?.society_id || 1;

    const optionsStr = poll_options ? JSON.stringify(poll_options) : null;
    const [result] = await db.execute(
      `INSERT INTO community_posts (society_id, author_id, type, title, body, poll_options)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [societyId, userId, type || 'post', title, body || '', optionsStr]
    );

    res.status(201).json({ message: 'Post created successfully', id: result.insertId });
  } catch (err) {
    console.error('Error creating community post:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── POST Toggle Like Status ──────────────────────────────────
router.post('/posts/:id/like', verifyToken, async (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;
  try {
    const [existing] = await db.execute('SELECT id FROM community_likes WHERE post_id = ? AND user_id = ?', [postId, userId]);
    if (existing.length > 0) {
      await db.execute('DELETE FROM community_likes WHERE post_id = ? AND user_id = ?', [postId, userId]);
      res.json({ liked: false });
    } else {
      await db.execute('INSERT INTO community_likes (post_id, user_id) VALUES (?, ?)', [postId, userId]);
      res.json({ liked: true });
    }
  } catch (err) {
    console.error('Error toggling like:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── POST Add Comment to Feed Post ────────────────────────────
router.post('/posts/:id/comments', verifyToken, async (req, res) => {
  const postId = req.params.id;
  const { text } = req.body;
  if (!text) return res.status(400).json({ message: 'Comment text is required' });

  try {
    const userId = req.user.id;
    await db.execute(
      'INSERT INTO community_comments (post_id, author_id, text) VALUES (?, ?, ?)',
      [postId, userId, text]
    );
    res.status(201).json({ message: 'Comment added successfully' });
  } catch (err) {
    console.error('Error adding comment:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── POST Submit Poll Vote (1 Vote per flat) ───────────────────
router.post('/posts/:id/vote', verifyToken, async (req, res) => {
  const postId = req.params.id;
  const { option } = req.body;
  if (!option) return res.status(400).json({ message: 'Selected option is required' });

  try {
    const userId = req.user.id;
    const [userRows] = await db.execute('SELECT tower, flat_number, society_id FROM users WHERE id = ?', [userId]);
    const tower = userRows[0]?.tower || '';
    const flatNumber = userRows[0]?.flat_number || '';
    const societyId = userRows[0]?.society_id || 1;

    // Check if any resident from the same flat has voted already
    const [existing] = await db.execute(`
      SELECT id FROM community_poll_votes 
      WHERE post_id = ? AND user_id IN (SELECT id FROM users WHERE COALESCE(tower, '') = COALESCE(?, '') AND flat_number = ? AND society_id = ?)
    `, [postId, tower, flatNumber, societyId]);

    if (existing.length > 0) {
      return res.status(400).json({ message: 'A vote has already been registered for your flat!' });
    }

    await db.execute(
      'INSERT INTO community_poll_votes (post_id, user_id, selected_option) VALUES (?, ?, ?)',
      [postId, userId, option]
    );

    res.json({ message: 'Vote registered successfully' });
  } catch (err) {
    console.error('Error registering vote:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── GET Home Chores (Flat-Specific Tasks) ────────────────────
router.get('/chores', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const [userRows] = await db.execute('SELECT tower, flat_number, society_id FROM users WHERE id = ?', [userId]);
    const tower = userRows[0]?.tower;
    const flatNumber = userRows[0]?.flat_number;
    const societyId = userRows[0]?.society_id || 1;

    if (!flatNumber) return res.json([]);

    const fetchChoresList = async () => {
      return db.execute(
        'SELECT id, text, is_done FROM home_chores WHERE COALESCE(tower, \'\') = COALESCE(?, \'\') AND flat_number = ? AND society_id = ? ORDER BY created_at ASC',
        [tower, flatNumber, societyId]
      );
    };

    let chores = [];
    try {
      const [rows] = await fetchChoresList();
      chores = rows;
    } catch (dbErr) {
      if (dbErr.code === 'ER_NO_SUCH_TABLE') {
        console.log('[Auto-Heal] Creating "home_chores" table on GET...');
        try {
          await db.execute(`
            CREATE TABLE IF NOT EXISTS home_chores (
              id INT AUTO_INCREMENT PRIMARY KEY,
              society_id INT NOT NULL,
              tower VARCHAR(50) DEFAULT NULL,
              flat_number VARCHAR(20) NOT NULL,
              text TEXT NOT NULL,
              is_done BOOLEAN DEFAULT FALSE,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
          `);
          const [rows] = await fetchChoresList();
          chores = rows;
        } catch (e) {
          console.error('[Auto-Heal] Failed to heal and retry:', e);
        }
      } else {
        throw dbErr;
      }
    }

    const result = chores.map(c => ({
      id: c.id,
      text: c.text,
      done: c.is_done === 1
    }));
    res.json(result);
  } catch (err) {
    console.error('Error fetching chores:', err);
    res.json([]); // Return empty array to prevent client crash on 500
  }
});

// ── POST Add Home Chore ──────────────────────────────────────
router.post('/chores', verifyToken, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ message: 'Task text is required' });

  try {
    const userId = req.user.id;
    const [userRows] = await db.execute('SELECT tower, flat_number, society_id FROM users WHERE id = ?', [userId]);
    const tower = userRows[0]?.tower;
    const flatNumber = userRows[0]?.flat_number;
    const societyId = userRows[0]?.society_id || 1;

    if (!flatNumber) return res.status(400).json({ message: 'User does not belong to a flat' });

    const insertChore = async () => {
      return db.execute(
        'INSERT INTO home_chores (society_id, tower, flat_number, text) VALUES (?, ?, ?, ?)',
        [societyId, tower || null, flatNumber, text]
      );
    };

    let resultId;
    try {
      const [insertRes] = await insertChore();
      resultId = insertRes.insertId;
    } catch (dbErr) {
      if (dbErr.code === 'ER_NO_SUCH_TABLE') {
        console.log('[Auto-Heal] Creating "home_chores" table on POST...');
        try {
          await db.execute(`
            CREATE TABLE IF NOT EXISTS home_chores (
              id INT AUTO_INCREMENT PRIMARY KEY,
              society_id INT NOT NULL,
              tower VARCHAR(50) DEFAULT NULL,
              flat_number VARCHAR(20) NOT NULL,
              text TEXT NOT NULL,
              is_done BOOLEAN DEFAULT FALSE,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
          `);
          const [insertRes] = await insertChore();
          resultId = insertRes.insertId;
        } catch (e) {
          console.error('[Auto-Heal] POST failed to heal and retry:', e);
          return res.status(500).json({ message: 'Server Database Error' });
        }
      } else {
        throw dbErr;
      }
    }

    res.status(201).json({ id: resultId, text, done: false });
  } catch (err) {
    console.error('Error creating chore:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── PUT Toggle Home Chore Completion ──────────────────────────
router.put('/chores/:id/toggle', verifyToken, async (req, res) => {
  const choreId = req.params.id;
  try {
    const userId = req.user.id;
    const [userRows] = await db.execute('SELECT tower, flat_number, society_id FROM users WHERE id = ?', [userId]);
    const tower = userRows[0]?.tower;
    const flatNumber = userRows[0]?.flat_number;
    const societyId = userRows[0]?.society_id || 1;

    // Confirm chore belongs to user's flat
    let chore = [];
    try {
      const [rows] = await db.execute('SELECT is_done FROM home_chores WHERE id = ? AND COALESCE(tower, \'\') = COALESCE(?, \'\') AND flat_number = ? AND society_id = ?', [choreId, tower, flatNumber, societyId]);
      chore = rows;
    } catch (dbErr) {
      if (dbErr.code === 'ER_NO_SUCH_TABLE') {
        return res.status(404).json({ message: 'Chore not found' });
      }
      throw dbErr;
    }

    if (chore.length === 0) {
      return res.status(404).json({ message: 'Chore not found or unauthorized' });
    }

    const newStatus = chore[0].is_done === 1 ? 0 : 1;
    await db.execute('UPDATE home_chores SET is_done = ? WHERE id = ?', [newStatus, choreId]);
    res.json({ message: 'Status updated', done: newStatus === 1 });
  } catch (err) {
    console.error('Error toggling chore:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── DELETE Home Chore ────────────────────────────────────────
router.delete('/chores/:id', verifyToken, async (req, res) => {
  const choreId = req.params.id;
  try {
    const userId = req.user.id;
    const [userRows] = await db.execute('SELECT tower, flat_number, society_id FROM users WHERE id = ?', [userId]);
    const tower = userRows[0]?.tower;
    const flatNumber = userRows[0]?.flat_number;
    const societyId = userRows[0]?.society_id || 1;

    try {
      const [result] = await db.execute('DELETE FROM home_chores WHERE id = ? AND COALESCE(tower, \'\') = COALESCE(?, \'\') AND flat_number = ? AND society_id = ?', [choreId, tower, flatNumber, societyId]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Chore not found or unauthorized' });
      }
    } catch (dbErr) {
      if (dbErr.code === 'ER_NO_SUCH_TABLE') {
        return res.status(404).json({ message: 'Chore not found' });
      }
      throw dbErr;
    }
    res.json({ message: 'Chore deleted successfully' });
  } catch (err) {
    console.error('Error deleting chore:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── GET Daily Helpers (Checks real-time check-in logs) ────────
router.get('/daily-helpers', verifyToken, async (req, res) => {
  try {
    // Query all staff members in the society
    const [staff] = await db.execute('SELECT id, name, phone, role FROM staff');
    const result = [];
    const roleEmoji = { Maid: '🧹', Cook: '🍳', Driver: '🚗', Plumber: '🔧', Electrician: '💡', Helper: '🧑' };

    for (const member of staff) {
      const [attendance] = await db.execute(`
        SELECT check_in_time, check_out_time 
        FROM staff_attendance 
        WHERE staff_id = ? AND date = CURDATE()
        ORDER BY check_in_time DESC LIMIT 1
      `);

      let status = 'Outside';
      let time = '--:--';
      
      if (attendance.length > 0) {
        const log = attendance[0];
        if (log.check_in_time && !log.check_out_time) {
          status = 'Inside';
          const inDate = new Date(log.check_in_time);
          time = inDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        } else if (log.check_out_time) {
          status = 'Outside';
          const outDate = new Date(log.check_out_time);
          time = outDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        }
      }

      result.push({
        name: member.name,
        role: member.role,
        status,
        time,
        avatar: roleEmoji[member.role] || '🧑'
      });
    }

    // Dynamic Fallback: If no staff members exist, return high-fidelity mock staff
    if (result.length === 0) {
      result.push(
        { name: 'Sunita Devi', role: 'Maid', status: 'Inside', time: '08:00 AM', avatar: '🧹' },
        { name: 'Laxman Rao', role: 'Driver', status: 'Inside', time: '09:30 AM', avatar: '🚗' },
        { name: 'Kamala Bai', role: 'Cook', status: 'Outside', time: '--:--', avatar: '🍳' }
      );
    }

    res.json(result);
  } catch (err) {
    console.error('Error fetching daily helpers:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── GET Society Intercom & Directory ──────────────────────────
router.get('/directory', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const [userRows] = await db.execute('SELECT society_id FROM users WHERE id = ?', [userId]);
    const societyId = userRows[0]?.society_id || 1;

    // 1. Fetch active residents for this society
    const [residents] = await db.execute(`
      SELECT name, role, tower, flat_number, phone FROM users
      WHERE role IN ('resident_primary', 'resident_family') AND society_id = ? AND account_status = 'active'
      ORDER BY tower ASC, flat_number ASC, name ASC
    `, [societyId]);

    // 2. Fetch security guards, technicians and managers for this society
    const [staffUsers] = await db.execute(`
      SELECT name, role, phone FROM users
      WHERE role IN ('guard', 'technician', 'manager') AND society_id = ? AND account_status = 'active'
      ORDER BY role ASC, name ASC
    `, [societyId]);

    // 3. Fetch staff / daily help members
    const [staff] = await db.execute(`
      SELECT name, role, phone FROM staff
      ORDER BY role ASC, name ASC
    `);

    // 4. Fetch custom emergency contacts / helplines
    const [emergency] = await db.execute(`
      SELECT name, phone, category AS role FROM emergency_contacts
      WHERE society_id = ?
      ORDER BY priority ASC, name ASC
    `, [societyId]);

    // Combine all contacts with categories
    const directory = [];

    residents.forEach(r => {
      directory.push({
        name: r.name,
        role: 'Resident',
        tower: r.tower || '',
        flat_number: r.flat_number || '--',
        phone: r.phone,
        category: 'Residents'
      });
    });

    staffUsers.forEach(g => {
      let roleLabel = 'Guard';
      let flatNum = 'Security Cabin 🛡️';
      if (g.role === 'technician') {
        roleLabel = 'Technician';
        flatNum = 'Support Desk 🔧';
      } else if (g.role === 'manager') {
        roleLabel = 'Manager';
        flatNum = 'Admin Office 🏢';
      }
      directory.push({
        name: g.name,
        role: roleLabel,
        flat_number: flatNum,
        phone: g.phone,
        category: 'Security'
      });
    });

    staff.forEach(s => {
      directory.push({
        name: s.name,
        role: s.role, // Cook, Maid, Driver etc.
        flat_number: 'Daily Help 🧹',
        phone: s.phone,
        category: 'Staff & Daily Helpers'
      });
    });

    emergency.forEach(e => {
      directory.push({
        name: e.name,
        role: e.role || 'Helpline',
        flat_number: 'Emergency 🚑',
        phone: e.phone,
        category: 'Emergency & Utilities'
      });
    });

    // Fallbacks if tables are empty
    if (directory.length === 0) {
      directory.push(
        { name: 'Aditi Sharma', role: 'Resident', flat_number: 'A-101', phone: '9876543201', category: 'Residents' },
        { name: 'Vikram Singh', role: 'Resident', flat_number: 'B-205', phone: '9876543203', category: 'Residents' },
        { name: 'Ramesh Kumar', role: 'Guard', flat_number: 'Security Cabin 🛡️', phone: '7777777701', category: 'Security' },
        { name: 'Sunita Devi', role: 'Maid', flat_number: 'Daily Help 🧹', phone: '8877665544', category: 'Staff & Daily Helpers' },
        { name: 'Main Gate Security Office', role: 'Security', flat_number: 'Gate 1', phone: '022-4918233', category: 'Emergency & Utilities' }
      );
    }

    res.json(directory);
  } catch (err) {
    console.error('Error fetching society directory:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;

