const mainService = require('../services/main.service');

// 1. 우리들의 연대 (의제별 4건)
exports.getOurs = async (req, res) => {
    try {
        const { topic } = req.query;
        if (!topic) return res.status(400).json({ success: false, message: "의제(topic) 정보가 필요합니다." });
        
        const data = await mainService.getOursByTopic(topic);
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. 실시간 HOT 연대 (전체 누적 6건)
exports.getRealtime = async (req, res) => {
    try {
        const data = await mainService.getGlobalSolidarity('realtime');
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. 마감 임박 연대 (24시간 이내 6건)
exports.getImminent = async (req, res) => {
    try {
        const data = await mainService.getGlobalSolidarity('imminent');
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
