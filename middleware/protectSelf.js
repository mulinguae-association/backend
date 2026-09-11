const protectSelf = (req, res, next) => {
  if (req.user._id.equals(req.params.id)) {
    return res.status(403).json({
      error: "You cannot perform this action on yourself",
    });
  }
  next();
};

export default protectSelf;
