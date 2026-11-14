from app.config import apply_offline_mode, get_settings

# До любых импортов, тянущих huggingface_hub, — см. apply_offline_mode
apply_offline_mode(get_settings())
