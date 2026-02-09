const protectHigherRole = (targetGetter) => {
  return async (req, res, next) => {
    const roleRank = {
      superadmin: 3,
      admin: 2,
      user: 1,
    };
    const target = await targetGetter(req);

    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }
    if (roleRank[req.user.role] <= roleRank[target.role]) {
      return res
        .status(403)
        .json({ error: "Forbidden: Insufficient role hierarchy" });
    }
    req.target = target;

    next();
  };
};

export default protectHigherRole;
