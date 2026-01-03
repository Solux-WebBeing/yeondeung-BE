const mainService = require('../services/main.service');

// 1. 우리들의 연대 (의제별 4건) - 비로그인 허용
exports.getOurs = async (req, res) => {
    try {
        const { topic } = req.query;
        if (!topic) return res.status(400).json({ success: false, message: "의제(topic) 정보가 필요합니다." });
        
        // [수정] 서비스 호출 시 req.user?.id 를 추가로 전달합니다.
        const data = await mainService.getOursByTopic(topic, req.user?.id);
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. 실시간 HOT 연대 (전체 누적 6건) - 비로그인 허용
exports.getRealtime = async (req, res) => {
    try {
        // [수정] 서비스 호출 시 req.user?.id 를 추가로 전달합니다.
        const data = await mainService.getGlobalSolidarity('realtime', req.user?.id);
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. 마감 임박 연대 (24시간 이내 6건) - 비로그인 허용
exports.getImminent = async (req, res) => {
    try {
        // [수정] 서비스 호출 시 req.user?.id 를 추가로 전달합니다.
        const data = await mainService.getGlobalSolidarity('imminent', req.user?.id);
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};